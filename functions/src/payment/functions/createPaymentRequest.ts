import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError, toIso } from "../../common";
import { PackagePaymentRequest, MembershipPaymentRequest } from "../types/payment.model";
import { PaymentStatus } from "../types/payment.enums";
import { CreatePackagePaymentData, CreateMembershipPaymentData } from "../types/payment.dto";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription, MembershipSubscription } from "../../subscription/types/subscription.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { sendAndStoreNotification } from "../../notification/utils/sendAndStoreNotification";
import { ensureMonthlyPaymentsUpToMonth } from "../../subscription/utils/membershipPayments";

export const createPaymentRequest = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece öğrenciler tarafından yapılabilir.');
    }

    const studentId = request.auth.uid;
    const data = request.data as CreatePackagePaymentData | CreateMembershipPaymentData;

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        const studentData = studentDoc.data();
        const subscriptionId = studentData?.activeSubscriptionId;

        if (!subscriptionId) {
            throw new HttpsError('failed-precondition', 'Aktif aboneliğiniz bulunmuyor.');
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();

        if (!subscriptionDoc.exists) {
            throw new HttpsError('not-found', 'Abonelik kaydı bulunamadı.');
        }

        const subscription = subscriptionDoc.data();
        const gymId = subscription?.gymId;

        if (!gymId) {
            throw new HttpsError('failed-precondition', 'Aboneliğe bağlı spor salonu bilgisi eksik.');
        }

        const paymentRef = db.collection(COLLECTIONS.PAYMENT_REQUESTS).doc();
        const paymentId = paymentRef.id;

        let newPaymentRequest: PackagePaymentRequest | MembershipPaymentRequest;

        if (subscription?.type === PaymentMethodType.PACKAGE) {
            // Package-based payment
            if (!('sessionCount' in data)) {
                throw new HttpsError('invalid-argument', 'Ders sayısı belirtilmesi zorunludur.');
            }

            const sessionCount = data.sessionCount;
            if (!Number.isInteger(sessionCount) || sessionCount < 1) {
                throw new HttpsError('invalid-argument', 'En az 1 ders için ödeme yapmalısınız.');
            }

            const packageSub = subscription as PackageSubscription;
            if (packageSub.pricePerSession <= 0 || packageSub.totalSessions <= 0) {
                throw new HttpsError('failed-precondition', 'Paket bilgileri geçersiz olduğu için ödeme talebi oluşturulamıyor.');
            }

            // Ödeme limiti completed seanslara göre değil, paket toplam hakkına göre hesaplanır.
            const paidSessionCount = Math.floor(packageSub.totalPaid / packageSub.pricePerSession);
            const maxPayableSessions = Math.max(0, packageSub.totalSessions - paidSessionCount);

            if (maxPayableSessions <= 0) {
                throw new HttpsError('already-exists', 'Bütün paketlerinizi zaten ödediniz ve borcunuz bulunmuyor.');
            }

            if (sessionCount > maxPayableSessions) {
                const remainingDebt = maxPayableSessions * packageSub.pricePerSession;
                throw new HttpsError('invalid-argument', `En fazla ${maxPayableSessions} ders için ödeme yapabilirsiniz. Kalan borcunuz: ${remainingDebt}₺`);
            }

            const totalAmount = sessionCount * packageSub.pricePerSession;

            newPaymentRequest = {
                id: paymentId,
                studentId: studentId,
                subscriptionId: subscriptionId,
                gymId: gymId,
                type: PaymentMethodType.PACKAGE,
                sessionCount: sessionCount,
                pricePerSession: packageSub.pricePerSession,
                totalAmount: totalAmount,
                status: PaymentStatus.PENDING,
                createdAt: admin.firestore.Timestamp.now()
            };

        } else {
            if (!('monthNumber' in data)) {
                throw new HttpsError('invalid-argument', 'Ay numarası belirtilmesi zorunludur.');
            }

            const monthNumber = data.monthNumber;
            const membershipSub = subscription as MembershipSubscription;

            if (!Number.isInteger(monthNumber) || monthNumber < 1) {
                throw new HttpsError('invalid-argument', 'Ay numarası 1 veya daha büyük bir tam sayı olmalıdır.');
            }

            const monthlyPayments = ensureMonthlyPaymentsUpToMonth(membershipSub, monthNumber);
            const monthlyPayment = monthlyPayments[monthNumber - 1];

            if (!monthlyPayment) {
                throw new HttpsError('not-found', 'Bu aya ait ödeme kaydı bulunamadı.');
            }

            if (monthlyPayment.status === 'paid') {
                throw new HttpsError('already-exists', 'Bu ay için ödeme zaten yapılmış.');
            }

            if (monthlyPayments.length !== (membershipSub.monthlyPayments || []).length) {
                await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).update({
                    monthlyPayments,
                    updatedAt: admin.firestore.Timestamp.now()
                });
            }

            const paymentAmount = monthlyPayment.amount;

            newPaymentRequest = {
                id: paymentId,
                studentId,
                subscriptionId,
                gymId,
                type: PaymentMethodType.MEMBERSHIP,
                monthNumber,
                monthlyAmount: paymentAmount,
                status: PaymentStatus.PENDING,
                createdAt: admin.firestore.Timestamp.now()
            };
        }
        const studentRef = db.collection(COLLECTIONS.STUDENTS).doc(studentId);
        const paymentBatch = db.batch();
        paymentBatch.set(paymentRef, newPaymentRequest);
        paymentBatch.update(studentRef, { pendingPaymentCount: admin.firestore.FieldValue.increment(1) });
        await paymentBatch.commit();
        const [coachSnap, adminSnap] = await Promise.all([
            db.collection(COLLECTIONS.COACHES).where("gymId", "==", gymId).get(),
            db.collection(COLLECTIONS.ADMINS).where("gymIds", "array-contains", gymId).get()
        ]);

        const coachIds = coachSnap.docs.map(d => d.id);
        const adminIds = adminSnap.docs.map(d => d.id);
        await sendAndStoreNotification({
            recipients: [
                { ids: coachIds, role: "coach" },
                { ids: adminIds, role: "admin" }
            ],
            notification: {
                title: "Yeni Ödeme Talebi",
                body: "Onay bekleyen yeni bir ödeme talebi var."
            },
            data: {
                type: "payment_request_created",
                paymentId: paymentId
            },
            gymId
        });
        // Log kaydı
        await logActivity({
            action: LogAction.CREATE_PAYMENT_REQUEST,
            category: LogCategory.PAYMENT,
            performedBy: {
                uid: studentId,
                role: 'student',
                name: request.auth!.token.name || 'Student'
            },
            targetEntity: {
                id: paymentId,
                type: 'payment',
                name: `Ödeme Talebi - ${newPaymentRequest.type}`
            },
            gymId: gymId,
            details: {
                type: newPaymentRequest.type,
                amount: newPaymentRequest.type === PaymentMethodType.PACKAGE
                    ? (newPaymentRequest as PackagePaymentRequest).totalAmount
                    : (newPaymentRequest as MembershipPaymentRequest).monthlyAmount
            }
        });

        return {
            success: true,
            message: "Ödeme talebiniz oluşturuldu. Hoca veya admin onayı bekleniyor.",
            paymentRequestId: paymentId,
            createdAt: toIso(newPaymentRequest.createdAt),
            totalAmount: newPaymentRequest.type === PaymentMethodType.PACKAGE
                ? (newPaymentRequest as PackagePaymentRequest).totalAmount
                : (newPaymentRequest as MembershipPaymentRequest).monthlyAmount
        };

    } catch (error: any) {
        console.error("Ödeme talebi oluşturma hatası:", error);

        await logError({
            functionName: 'createPaymentRequest',
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
