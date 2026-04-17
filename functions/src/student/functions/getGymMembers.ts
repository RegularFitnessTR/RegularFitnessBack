import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetGymMembersData } from "../types/student.dto";

function parseLimit(rawLimit: unknown): number {
    const requested = Number(rawLimit ?? 100);
    if (Number.isNaN(requested)) {
        return 100;
    }
    return Math.min(Math.max(requested, 1), 200);
}

export const getGymMembers = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetGymMembersData;
    const gymId = typeof data.gymId === 'string' ? data.gymId.trim() : '';

    if (!gymId) {
        throw new HttpsError('invalid-argument', 'Gym ID zorunludur.');
    }

    if (role === 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const limit = parseLimit(data.limit);

    try {
        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu salon üyelerini görüntüleme yetkiniz yok.');
            }
        } else if (role === 'coach') {
            const ownGymId: string = request.auth.token.gymId || '';
            if (!ownGymId || ownGymId !== gymId) {
                throw new HttpsError('permission-denied', 'Sadece kendi salonunuzdaki üyeleri görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        const snapshot = await db.collection(COLLECTIONS.STUDENTS)
            .where('gymId', '==', gymId)
            .limit(limit)
            .get();

        const members = snapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            members
        };
    } catch (error: any) {
        await logError({
            functionName: 'getGymMembers',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { gymId, limit }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Salon üyeleri alınırken bir hata oluştu.');
    }
});
