import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { GetLogsData } from "../types/log.dto";
import { ActivityLog } from "../types/log.model";

export const getSuperAdminLogs = onCall(async (request) => {
    // 1. Auth kontrolü
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // 2. Yetki kontrolü: Sadece SuperAdmin
    if (request.auth.token.role !== 'superadmin' && !request.auth.token.superadmin) {
        throw new HttpsError('permission-denied', 'Bu işlem için SuperAdmin yetkisi gereklidir.');
    }

    const data = request.data as GetLogsData;

    try {
        const limit = Math.min(data.limit || 50, 200);

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.ACTIVITY_LOGS)
            .orderBy('timestamp', 'desc');

        // Kategori filtresi
        if (data.category) {
            query = query.where('category', '==', data.category);
        }

        // Aksiyon filtresi
        if (data.action) {
            query = query.where('action', '==', data.action);
        }

        // Tarih aralığı filtresi
        if (data.startDate) {
            const startTimestamp = new Date(data.startDate);
            query = query.where('timestamp', '>=', startTimestamp);
        }

        if (data.endDate) {
            const endTimestamp = new Date(data.endDate);
            query = query.where('timestamp', '<=', endTimestamp);
        }

        // Sayfalama
        if (data.startAfter) {
            const startAfterDoc = await db.collection(COLLECTIONS.ACTIVITY_LOGS).doc(data.startAfter).get();
            if (startAfterDoc.exists) {
                query = query.startAfter(startAfterDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();

        const logs: ActivityLog[] = snapshot.docs.map(doc => doc.data() as ActivityLog);

        return {
            success: true,
            logs: logs,
            count: logs.length,
            hasMore: logs.length === limit,
            lastDocId: logs.length > 0 ? logs[logs.length - 1].id : null
        };

    } catch (error: any) {
        console.error("SuperAdmin log sorgulama hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Log kayıtları sorgulanırken bir hata oluştu.');
    }
});
