import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetGymCoachesData } from "../types/coach.dto";

function parseLimit(rawLimit: unknown): number {
    const requested = Number(rawLimit ?? 50);
    if (Number.isNaN(requested)) {
        return 50;
    }
    return Math.min(Math.max(requested, 1), 100);
}

export const getGymCoaches = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetGymCoachesData;
    const gymId = typeof data.gymId === 'string' ? data.gymId.trim() : '';

    if (!gymId) {
        throw new HttpsError('invalid-argument', 'Gym ID zorunludur.');
    }

    const limit = parseLimit(data.limit);

    try {
        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu salondaki koçları görüntüleme yetkiniz yok.');
            }
        } else if (role === 'coach' || role === 'student') {
            const ownGymId: string = request.auth.token.gymId || '';
            if (!ownGymId || ownGymId !== gymId) {
                throw new HttpsError('permission-denied', 'Sadece kendi salonunuzdaki koçları görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        const snapshot = await db.collection(COLLECTIONS.COACHES)
            .where('gymId', '==', gymId)
            .limit(limit)
            .get();

        const coaches = snapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            coaches
        };
    } catch (error: any) {
        void logError({
            functionName: 'getGymCoaches',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { gymId, limit }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Salon koçları alınırken bir hata oluştu.');
    }
});
