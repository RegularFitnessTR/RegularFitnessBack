import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { logError } from "../../log/utils/logError";

export const getPaymentRequests = onCall(async (request) => {
    // 1. Yetki Kontrolü: Coach veya Admin
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca veya admin yetkisi gereklidir.');
    }

    const { status, gymId } = request.data as { status?: PaymentStatus; gymId?: string };

    try {
        let query = db.collection(COLLECTIONS.PAYMENT_REQUESTS) as any;

        // Filter by gym if coach
        if (role === 'coach') {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
            const coachData = coachDoc.data();
            const coachGymId = coachData?.gymId;

            if (!coachGymId) {
                throw new HttpsError('failed-precondition', 'Bir spor salonuna atanmamışsınız.');
            }

            query = query.where('gymId', '==', coachGymId);
        } else if (gymId && role === 'admin') {
            // Admin can filter by specific gym
            query = query.where('gymId', '==', gymId);
        }

        // Filter by status if provided
        if (status) {
            query = query.where('status', '==', status);
        }

        // Order by creation date (newest first)
        query = query.orderBy('createdAt', 'desc');

        const snapshot = await query.get();
        const paymentRequests = snapshot.docs.map((doc: any) => doc.data());

        return {
            success: true,
            paymentRequests: paymentRequests,
            count: paymentRequests.length
        };

    } catch (error: any) {
        console.error("Ödeme talepleri getirme hatası:", error);

        await logError({
            functionName: 'getPaymentRequests',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { status, gymId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
