import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { GetLogsData } from "../types/log.dto";
import { ActivityLog } from "../types/log.model";
import { logError } from "../utils/logError";
import { mapLogForResponse } from "../utils/logPresentation";

export const getAdminLogs = onCall(async (request) => {
    // 1. Auth kontrolü
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // 2. Yetki kontrolü: Sadece Admin
    const { role } = request.auth.token;
    if (role !== 'admin') {
        throw new HttpsError('permission-denied', 'Bu işlem için Admin yetkisi gereklidir.');
    }

    const data = (request.data ?? {}) as GetLogsData;
    const selectedGymId = data.gymId;

    if (!selectedGymId) {
        throw new HttpsError('invalid-argument', 'Admin için gymId zorunludur.');
    }

    try {
        // 3. Admin'in gym'lerini custom claims'den al
        const gymIds: string[] = request.auth.token.gymIds || [];

        if (gymIds.length === 0) {
            return {
                success: true,
                logs: [],
                count: 0,
                hasMore: false,
                lastDocId: null
            };
        }

        if (!gymIds.includes(selectedGymId)) {
            throw new HttpsError('permission-denied', 'Bu spor salonuna ait logları görüntüleme yetkiniz yok.');
        }

        const limit = Math.min(data.limit || 50, 200);

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.ACTIVITY_LOGS)
            .where('gymId', '==', selectedGymId)
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
            const startTimestamp = admin.firestore.Timestamp.fromDate(new Date(data.startDate));
            query = query.where('timestamp', '>=', startTimestamp);
        }

        if (data.endDate) {
            const endTimestamp = admin.firestore.Timestamp.fromDate(new Date(data.endDate));
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
        const formattedLogs = logs.map(mapLogForResponse);

        return {
            success: true,
            logs: formattedLogs,
            count: formattedLogs.length,
            hasMore: formattedLogs.length === limit,
            lastDocId: formattedLogs.length > 0 ? formattedLogs[formattedLogs.length - 1].id : null
        };

    } catch (error: any) {
        console.error("Admin log sorgulama hatası:", error);

        await logError({
            functionName: 'getAdminLogs',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Log kayıtları sorgulanırken bir hata oluştu.');
    }
});
