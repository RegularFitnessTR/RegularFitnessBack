import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { GetLogsData } from "../types/log.dto";
import { ActivityLog } from "../types/log.model";
import { logError } from "../utils/logError";
import { mapLogForResponse } from "../utils/logPresentation";

export const getSuperAdminLogs = onCall(async (request) => {
    // 1. Auth kontrolü
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // 2. Yetki kontrolü: Sadece SuperAdmin
    if (request.auth.token.role !== 'superadmin' && !request.auth.token.superadmin) {
        throw new HttpsError('permission-denied', 'Bu işlem için SuperAdmin yetkisi gereklidir.');
    }

    const data = (request.data ?? {}) as GetLogsData;

    try {
        const limit = Math.min(data.limit || 50, 200);

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.ACTIVITY_LOGS)
            .orderBy('timestamp', 'desc');

        // Gym filtresi
        if (data.gymId) {
            query = query.where('gymId', '==', data.gymId);
        }

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

        // Sayfalama (timestamp cursor)
        if (data.startAfterTimestamp !== undefined) {
            const cursorMillis = Number(data.startAfterTimestamp);
            if (!Number.isFinite(cursorMillis) || cursorMillis <= 0) {
                throw new HttpsError('invalid-argument', 'startAfterTimestamp gecersiz. Milisaniye cinsinden gecerli bir deger gonderin.');
            }
            query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursorMillis));
        }

        query = query.limit(limit);

        const snapshot = await query.get();

        const logs: ActivityLog[] = snapshot.docs.map(doc => doc.data() as ActivityLog);
        const formattedLogs = logs.map(mapLogForResponse).map(log => serializeTimestamps(log));

        return {
            success: true,
            logs: formattedLogs,
            count: formattedLogs.length,
            hasMore: formattedLogs.length === limit,
            lastDocId: formattedLogs.length > 0 ? formattedLogs[formattedLogs.length - 1].id : null,
            lastTimestamp: formattedLogs.length > 0 ? logs[logs.length - 1].timestamp.toMillis() : null
        };

    } catch (error: any) {
        console.error("SuperAdmin log sorgulama hatası:", error);

        await logError({
            functionName: 'getSuperAdminLogs',
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
