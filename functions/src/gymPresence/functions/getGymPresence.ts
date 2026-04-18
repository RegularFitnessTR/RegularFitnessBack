import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetGymPresenceData } from "../types/gymPresence.dto";

function parseLimit(rawLimit: unknown): number {
    const requested = Number(rawLimit ?? 200);
    if (Number.isNaN(requested)) {
        return 200;
    }
    return Math.min(Math.max(requested, 1), 500);
}

// Token claim stale/eksik olabilir; coach profilinden güncel gymId ile fallback doğrula.
async function resolveCoachGymId(request: any): Promise<string> {
    const claimGymId: string = request.auth?.token?.gymId || '';
    if (claimGymId) {
        return claimGymId;
    }

    const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth.uid).get();
    if (!coachDoc.exists) {
        return '';
    }

    const profileGymId = coachDoc.data()?.gymId;
    return typeof profileGymId === 'string' ? profileGymId : '';
}

export const getGymPresence = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetGymPresenceData;
    const gymId = typeof data.gymId === 'string' ? data.gymId.trim() : '';

    if (!gymId) {
        throw new HttpsError('invalid-argument', 'Gym ID zorunludur.');
    }

    if (data.userRole !== undefined && data.userRole !== 'student' && data.userRole !== 'coach') {
        throw new HttpsError('invalid-argument', 'userRole yalnızca student veya coach olabilir.');
    }

    if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
        throw new HttpsError('invalid-argument', 'isActive boolean olmalıdır.');
    }

    if (role === 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const limit = parseLimit(data.limit);

    try {
        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu salonun giriş kayıtlarını görüntüleme yetkiniz yok.');
            }
        } else if (role === 'coach') {
            const ownGymId = await resolveCoachGymId(request);
            if (!ownGymId || ownGymId !== gymId) {
                throw new HttpsError('permission-denied', 'Sadece kendi salonunuzun giriş kayıtlarını görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.GYM_PRESENCE)
            .where('gymId', '==', gymId);

        if (data.userRole) {
            query = query.where('userRole', '==', data.userRole);
        }

        if (typeof data.isActive === 'boolean') {
            query = query.where('isActive', '==', data.isActive);
        }

        query = query.orderBy('checkedInAt', 'desc').limit(limit);

        const snapshot = await query.get();
        const records = snapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            records
        };
    } catch (error: any) {
        void logError({
            functionName: 'getGymPresence',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: {
                gymId,
                userRole: data.userRole,
                isActive: data.isActive,
                limit
            }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Salon giriş kayıtları alınırken bir hata oluştu.');
    }
});
