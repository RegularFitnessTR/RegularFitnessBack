import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logError } from "../../log/utils/logError";

// Firestore 'in' operatörü max 10 eleman destekler — büyük listeler için chunk'lara bölüp paralel sorgu yap
async function queryByGymIds(
    gymIds: string[],
    status?: PaymentStatus
): Promise<FirebaseFirestore.DocumentData[]> {
    const chunkSize = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < gymIds.length; i += chunkSize) {
        chunks.push(gymIds.slice(i, i + chunkSize));
    }

    const snapshots = await Promise.all(
        chunks.map((chunk) => {
            let q = db.collection(COLLECTIONS.PAYMENT_REQUESTS).where('gymId', 'in', chunk) as any;
            if (status) q = q.where('status', '==', status);
            q = q.orderBy('createdAt', 'desc');
            return q.get();
        })
    );

    const docs: FirebaseFirestore.DocumentData[] = [];
    snapshots.forEach((snap: any) => snap.docs.forEach((d: any) => docs.push(d.data())));

    // Birden fazla chunk varsa sonuçları createdAt'e göre sırala
    if (chunks.length > 1) {
        docs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    }

    return docs;
}

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
        let rawDocs: FirebaseFirestore.DocumentData[] = [];

        if (role === 'coach') {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
            const coachGymId = coachDoc.data()?.gymId;
            if (!coachGymId) {
                throw new HttpsError('failed-precondition', 'Bir spor salonuna atanmamışsınız.');
            }
            rawDocs = await queryByGymIds([coachGymId], status);

        } else if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminGymIds: string[] = adminDoc.data()?.gymIds || [];

            if (adminGymIds.length === 0) {
                return { success: true, paymentRequests: [], count: 0 };
            }

            if (gymId) {
                if (!adminGymIds.includes(gymId)) {
                    throw new HttpsError('permission-denied', 'Bu salona erişim yetkiniz yok.');
                }
                rawDocs = await queryByGymIds([gymId], status);
            } else {
                rawDocs = await queryByGymIds(adminGymIds, status);
            }

        } else {
            // superadmin: filtre yok, tüm ödeme talepleri
            let q = db.collection(COLLECTIONS.PAYMENT_REQUESTS) as any;
            if (status) q = q.where('status', '==', status);
            q = q.orderBy('createdAt', 'desc');
            const snap = await q.get();
            rawDocs = snap.docs.map((d: any) => d.data());
        }

        const paymentRequests = rawDocs.map((data) => ({
            ...data,
            // Frontend'e tutarlı tutar alanı sun
            amount: data.type === PaymentMethodType.PACKAGE
                ? data.totalAmount
                : data.monthlyAmount
        }));

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