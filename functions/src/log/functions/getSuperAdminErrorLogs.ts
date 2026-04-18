import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { GetErrorLogsData } from "../types/log.dto";
import { ErrorLog } from "../types/log.model";
import { logError } from "../utils/logError";

export const getSuperAdminErrorLogs = onCall(async (request) => {
    // 1. Auth kontrolü
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // 2. Yetki kontrolü: Sadece SuperAdmin
    if (request.auth.token.role !== 'superadmin' && !request.auth.token.superadmin) {
        throw new HttpsError('permission-denied', 'Bu işlem için SuperAdmin yetkisi gereklidir.');
    }

    const data = request.data as GetErrorLogsData;

    try {
        const limit = Math.min(data.limit || 50, 200);

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.ERROR_LOGS)
            .orderBy('timestamp', 'desc');

        // Severity filtresi
        if (data.severity) {
            query = query.where('severity', '==', data.severity);
        }

        // Function name filtresi
        if (data.functionName) {
            query = query.where('functionName', '==', data.functionName);
        }

        // Resolved filtresi
        if (data.resolved !== undefined) {
            query = query.where('resolved', '==', data.resolved);
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
            const startAfterDoc = await db.collection(COLLECTIONS.ERROR_LOGS).doc(data.startAfter).get();
            if (startAfterDoc.exists) {
                query = query.startAfter(startAfterDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();

        const logs: ErrorLog[] = snapshot.docs.map(doc => doc.data() as ErrorLog);

        return {
            success: true,
            logs: logs,
            count: logs.length,
            hasMore: logs.length === limit,
            lastDocId: logs.length > 0 ? logs[logs.length - 1].id : null
        };

    } catch (error: any) {
        console.error("SuperAdmin error log sorgulama hatası:", error);

        void logError({
            functionName: 'getSuperAdminErrorLogs',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Hata log kayıtları sorgulanırken bir hata oluştu.');
    }
});
