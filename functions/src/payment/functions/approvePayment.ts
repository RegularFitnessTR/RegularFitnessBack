import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
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

        // Verify authorization
        if (role === 'coach') {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
            const coachData = coachDoc.data();

            if (coachData?.gymId !== payment.gymId) {
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

            // Prevent overpayment
            const remainingDebt = subscription.totalDebt - subscription.totalPaid;
            if (payment.totalAmount > remainingDebt) {
                throw new HttpsError('failed-precondition', `Ödeme tutarı (${payment.totalAmount}₺) kalan borçtan (${remainingDebt}₺) fazla. Bu ödeme onaylanamaz.`);
            }

            const newTotalPaid = subscription.totalPaid + payment.totalAmount;
            const newCurrentBalance = newTotalPaid - subscription.totalDebt;

            batch.update(subscriptionDoc.ref, {
                totalPaid: newTotalPaid,
                currentBalance: newCurrentBalance,
                updatedAt: admin.firestore.Timestamp.now()
            });

        } else {
            // Membership-based: Mark month as paid
            const subscription = subscriptionDoc.data() as MembershipSubscription;

            const monthIndex = payment.monthNumber - 1;
            const monthlyPayments = [...subscription.monthlyPayments];
            monthlyPayments[monthIndex] = {
                ...monthlyPayments[monthIndex],
                status: 'paid',
                paidDate: admin.firestore.Timestamp.now(),
                paymentRequestId: data.paymentRequestId
            };

            const newTotalPaid = subscription.totalPaid + payment.monthlyAmount;
            const newCurrentBalance = subscription.totalAmount - newTotalPaid;

            batch.update(subscriptionDoc.ref, {
                monthlyPayments: monthlyPayments,
                totalPaid: newTotalPaid,
                currentBalance: -newCurrentBalance,
                updatedAt: admin.firestore.Timestamp.now()
            });
        }

        batch.update(paymentDoc.ref, {
            status: PaymentStatus.APPROVED,
            processedAt: admin.firestore.Timestamp.now(),
            processedBy: request.auth.uid,
            notes: data.notes || ''
        });

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
        await logActivity({
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
            message: "Ödeme talebi onaylandı."
        };

    } catch (error: any) {
        console.error("Ödeme onaylama hatası:", error);

        await logError({
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
