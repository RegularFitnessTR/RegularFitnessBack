import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError, toIso } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { ProcessPaymentData } from "../types/payment.dto";
import { MembershipPaymentRequest, PackagePaymentRequest, PaymentRequest } from "../types/payment.model";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { PackageSubscription, MembershipSubscription } from "../../subscription/types/subscription.model";
import { sendAndStoreNotification } from "../../notification/utils/sendAndStoreNotification";
import { ensureMonthlyPaymentsUpToMonth } from "../../subscription/utils/membershipPayments";

export const approvePayment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca veya admin yetkisi gereklidir.');
    }

    const data = request.data as ProcessPaymentData;

    if (!data.paymentRequestId) {
        throw new HttpsError('invalid-argument', 'Ödeme talebi ID belirtilmesi zorunludur.');
    }

    try {
        const paymentDoc = await db.collection(COLLECTIONS.PAYMENT_REQUESTS).doc(data.paymentRequestId).get();

        if (!paymentDoc.exists) {
            throw new HttpsError('not-found', 'Ödeme talebi bulunamadı.');
        }

        const payment = paymentDoc.data() as PaymentRequest;

        if (payment.status !== PaymentStatus.PENDING) {
            throw new HttpsError('failed-precondition', 'Bu ödeme talebi zaten işlenmiş.');
        }

        // Verify authorization (custom claims'den)
        if (role === 'coach') {
            if ((request.auth.token.gymId || '') !== payment.gymId) {
                throw new HttpsError('permission-denied', 'Bu spor salonunun ödemelerini onaylayamazsınız.');
            }
        } else if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(payment.gymId)) {
                throw new HttpsError('permission-denied', 'Bu spor salonunun ödemelerini onaylayamazsınız.');
            }
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(payment.subscriptionId).get();

        if (!subscriptionDoc.exists) {
            throw new HttpsError('not-found', 'Abonelik bulunamadı.');
        }

        const batch = db.batch();

        if (payment.type === PaymentMethodType.PACKAGE) {
            // Package-based: Update debt tracking
            const subscription = subscriptionDoc.data() as PackageSubscription;
            if (subscription.pricePerSession <= 0 || subscription.totalSessions <= 0) {
                throw new HttpsError('failed-precondition', 'Paket bilgileri geçersiz olduğu için ödeme onaylanamıyor.');
            }

            const expectedAmount = payment.sessionCount * subscription.pricePerSession;
            if (payment.totalAmount !== expectedAmount) {
                throw new HttpsError('failed-precondition', 'Ödeme talebi tutarı paket fiyatı ile uyuşmuyor.');
            }

            const paidSessionCount = Math.floor(subscription.totalPaid / subscription.pricePerSession);
            const remainingPayableSessions = Math.max(0, subscription.totalSessions - paidSessionCount);
            if (payment.sessionCount > remainingPayableSessions) {
                throw new HttpsError(
                    'failed-precondition',
                    `Ödeme talebi kalan ödenebilir ders hakkını aşıyor. En fazla ${remainingPayableSessions} ders ödenebilir.`
                );
            }

            const totalPackageDebt = subscription.totalSessions * subscription.pricePerSession;

            const newTotalPaid = subscription.totalPaid + payment.totalAmount;
            const newCurrentBalance = newTotalPaid - totalPackageDebt;

            batch.update(subscriptionDoc.ref, {
                totalDebt: totalPackageDebt,
                totalPaid: newTotalPaid,
                currentBalance: newCurrentBalance,
                updatedAt: admin.firestore.Timestamp.now()
            });

        } else {
            const subscription = subscriptionDoc.data() as MembershipSubscription;

            const monthIndex = payment.monthNumber - 1;
            const monthlyPayments = ensureMonthlyPaymentsUpToMonth(subscription, payment.monthNumber);

            if (!monthlyPayments[monthIndex]) {
                throw new HttpsError('not-found', 'Bu aya ait ödeme kaydı bulunamadı.');
            }
            if (monthlyPayments[monthIndex].status === 'paid') {
                throw new HttpsError('already-exists', 'Bu ay için ödeme zaten onaylanmış.');
            }

            const now = admin.firestore.Timestamp.now();

            monthlyPayments[monthIndex] = {
                ...monthlyPayments[monthIndex],
                status: 'paid',
                paidDate: now,
                paymentRequestId: data.paymentRequestId
            };

            const newTotalPaid = subscription.totalPaid + payment.monthlyAmount;

            // Taahhüt aktifse toplam taahhüt tutarına, değilse o ana kadar birikmiş
            // ödeme miktarına göre bakiye hesapla
            const totalExpected = subscription.isCommitmentActive
                ? subscription.totalAmount                          // taahhüt süresi toplam borcu
                : subscription.totalPaid + payment.monthlyAmount;  // açık uçlu: sadece ödenenler

            const newCurrentBalance = newTotalPaid - totalExpected;

            batch.update(subscriptionDoc.ref, {
                monthlyPayments,
                totalPaid: newTotalPaid,
                currentBalance: newCurrentBalance,
                updatedAt: now
            });
        }
        const processedAt = admin.firestore.Timestamp.now();

        batch.update(paymentDoc.ref, {
            status: PaymentStatus.APPROVED,
            processedAt,
            processedBy: request.auth.uid,
            notes: data.notes || ''
        });

        const studentRef = db.collection(COLLECTIONS.STUDENTS).doc(payment.studentId);
        batch.update(studentRef, { pendingPaymentCount: admin.firestore.FieldValue.increment(-1) });

        await batch.commit();


        await sendAndStoreNotification({
            recipients: [{ ids: [payment.studentId], role: "student" }],
            notification: {
                title: "Ödemeniz Onaylandı",
                body: payment.type === PaymentMethodType.PACKAGE
                    ? `${(payment as PackagePaymentRequest).totalAmount}₺ tutarındaki ödemeniz onaylandı.`
                    : `${(payment as MembershipPaymentRequest).monthNumber}. ay ödemesi onaylandı.`
            },
            data: {
                type: "payment_approved",
                paymentId: data.paymentRequestId
            },
            gymId: payment.gymId
        });
        // Log kaydı
        void logActivity({
            action: LogAction.APPROVE_PAYMENT,
            category: LogCategory.PAYMENT,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.paymentRequestId,
                type: 'payment',
                name: `Ödeme Onay - ${payment.type}`
            },
            gymId: payment.gymId,
            details: { studentId: payment.studentId, type: payment.type }
        });

        return {
            success: true,
            message: "Ödeme talebi onaylandı.",
            processedAt: toIso(processedAt)
        };

    } catch (error: any) {
        console.error("Ödeme onaylama hatası:", error);

        void logError({
            functionName: 'approvePayment',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
