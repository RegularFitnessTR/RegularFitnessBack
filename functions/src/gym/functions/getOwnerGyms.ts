import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetOwnerGymsData } from "../types/gym.dto";

function parseLimit(rawLimit: unknown): number {
    const requested = Number(rawLimit ?? 50);
    if (Number.isNaN(requested)) {
        return 50;
    }
    return Math.min(Math.max(requested, 1), 100);
}

export const getOwnerGyms = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetOwnerGymsData;
    const ownerId = typeof data.ownerId === 'string' ? data.ownerId.trim() : '';

    if (!ownerId) {
        throw new HttpsError('invalid-argument', 'Owner ID zorunludur.');
    }

    if (role === 'admin') {
        if (ownerId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Sadece kendi sahip olduğunuz salonları görüntüleyebilirsiniz.');
        }
    } else if (role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const limit = parseLimit(data.limit);

    try {
        const snapshot = await db.collection(COLLECTIONS.GYMS)
            .where('ownerId', '==', ownerId)
            .limit(limit)
            .get();

        const gyms = snapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            gyms
        };
    } catch (error: any) {
        await logError({
            functionName: 'getOwnerGyms',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { ownerId, limit }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Sahibe ait salonlar alınırken bir hata oluştu.');
    }
});
