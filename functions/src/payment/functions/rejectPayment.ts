import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { ProcessPaymentData } from "../types/payment.dto";
import { PaymentRequest } from "../types/payment.model";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const rejectPayment = onCall(async (request) => {
    // 1. Yetki Kontrolü: Coach veya Admin
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
        // 2. Get payment request
        const paymentDoc = await db.collection(COLLECTIONS.PAYMENT_REQUESTS).doc(data.paymentRequestId).get();

        if (!paymentDoc.exists) {
            throw new HttpsError('not-found', 'Ödeme talebi bulunamadı.');
        }

        const payment = paymentDoc.data() as PaymentRequest;

        if (payment.status !== PaymentStatus.PENDING) {
            throw new HttpsError('failed-precondition', 'Bu ödeme talebi zaten işlenmiş.');
        }

        // 3. Verify authorization
        if (role === 'coach') {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
            const coachData = coachDoc.data();

            if (coachData?.gymId !== payment.gymId) {
                throw new HttpsError('permission-denied', 'Bu spor salonunun ödemelerini reddedemezsiniz.');
            }
        }

        // 4. Update payment request
        await db.collection(COLLECTIONS.PAYMENT_REQUESTS).doc(data.paymentRequestId).update({
            status: PaymentStatus.REJECTED,
            processedAt: admin.firestore.Timestamp.now(),
            processedBy: request.auth.uid,
            notes: data.notes || 'Ödeme reddedildi.'
        });

        // Log kaydı
        await logActivity({
            action: LogAction.REJECT_PAYMENT,
            category: LogCategory.PAYMENT,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.paymentRequestId,
                type: 'payment',
                name: `Ödeme Red - ${payment.type}`
            },
            gymId: payment.gymId,
            details: { studentId: payment.studentId, notes: data.notes }
        });

        return {
            success: true,
            message: "Ödeme talebi reddedildi."
        };

    } catch (error: any) {
        console.error("Ödeme reddetme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
