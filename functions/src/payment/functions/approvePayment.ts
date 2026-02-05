import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { ProcessPaymentData } from "../types/payment.dto";
import { PaymentRequest } from "../types/payment.model";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription, MembershipSubscription } from "../../subscription/types/subscription.model";

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

        return {
            success: true,
            message: "Ödeme başarıyla onaylandı."
        };

    } catch (error: any) {
        console.error("Ödeme onaylama hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
