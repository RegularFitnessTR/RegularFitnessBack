import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logError } from "../../log/utils/logError";

export const getPaymentRequests = onCall(async (request) => {
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

        if (role === 'coach') {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
            const coachGymId = coachDoc.data()?.gymId;
            if (!coachGymId) {
                throw new HttpsError('failed-precondition', 'Bir spor salonuna atanmamışsınız.');
            }
            query = query.where('gymId', '==', coachGymId);

        } else if (role === 'admin') {
            // Admin gymId belirtmemişse kendi tüm salonlarını kapsa
            if (gymId) {
                // Belirtilen gymId adminın salonlarından biri mi kontrol et
                const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
                const adminGymIds: string[] = adminDoc.data()?.gymIds || [];
                if (!adminGymIds.includes(gymId)) {
                    throw new HttpsError('permission-denied', 'Bu salona erişim yetkiniz yok.');
                }
                query = query.where('gymId', '==', gymId);
            } else {
                const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
                const adminGymIds: string[] = adminDoc.data()?.gymIds || [];
                if (adminGymIds.length === 0) {
                    return { success: true, paymentRequests: [], count: 0 };
                }
                // Firestore 'in' operatörü max 10 eleman destekler
                query = query.where('gymId', 'in', adminGymIds.slice(0, 10));
            }
        }
        // superadmin: filtre yok, tüm ödeme talepleri

        if (status) {
            query = query.where('status', '==', status);
        }

        query = query.orderBy('createdAt', 'desc');

        const snapshot = await query.get();
        const paymentRequests = snapshot.docs.map((doc: any) => {
            const data = doc.data();
            return {
                ...data,
                // Frontend'e tutarlı tutar alanı sun
                amount: data.type === PaymentMethodType.PACKAGE
                    ? data.totalAmount
                    : data.monthlyAmount
            };
        });

        return {
            success: true,
            paymentRequests,
            count: paymentRequests.length
        };

    } catch (error: any) {
        await logError({
            functionName: 'getPaymentRequests',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { status, gymId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});