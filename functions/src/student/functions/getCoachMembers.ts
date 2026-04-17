import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetCoachMembersData } from "../types/student.dto";

function parseLimit(rawLimit: unknown): number {
    const requested = Number(rawLimit ?? 100);
    if (Number.isNaN(requested)) {
        return 100;
    }
    return Math.min(Math.max(requested, 1), 200);
}

export const getCoachMembers = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetCoachMembersData;
    const coachId = typeof data.coachId === 'string' ? data.coachId.trim() : '';

    if (!coachId) {
        throw new HttpsError('invalid-argument', 'Koç ID zorunludur.');
    }

    if (role === 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const limit = parseLimit(data.limit);

    try {
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Koç bulunamadı.');
        }

        const coachGymId = coachDoc.data()?.gymId;

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!coachGymId || !adminGymIds.includes(coachGymId)) {
                throw new HttpsError('permission-denied', 'Bu koçun öğrencilerini görüntüleme yetkiniz yok.');
            }
        } else if (role === 'coach') {
            if (coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Sadece kendi öğrencilerinizi görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        const snapshot = await db.collection(COLLECTIONS.STUDENTS)
            .where('coachId', '==', coachId)
            .limit(limit)
            .get();

        const members = snapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            members
        };
    } catch (error: any) {
        await logError({
            functionName: 'getCoachMembers',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { coachId, limit }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Koç öğrencileri alınırken bir hata oluştu.');
    }
});
