import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetCoachByIdData } from "../types/coach.dto";

export const getCoachById = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetCoachByIdData;
    const coachId = typeof data.coachId === 'string' ? data.coachId.trim() : '';

    if (!coachId) {
        throw new HttpsError('invalid-argument', 'Koç ID zorunludur.');
    }

    try {
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Koç bulunamadı.');
        }

        const coachData = coachDoc.data()!;
        const coachGymId = typeof coachData.gymId === 'string' ? coachData.gymId : '';

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!coachGymId || !adminGymIds.includes(coachGymId)) {
                throw new HttpsError('permission-denied', 'Bu koç kaydına erişim yetkiniz yok.');
            }
        } else if (role === 'coach') {
            if (coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Sadece kendi profilinizi görüntüleyebilirsiniz.');
            }
        } else if (role === 'student') {
            const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(request.auth.uid).get();
            if (!studentDoc.exists) {
                throw new HttpsError('not-found', 'Öğrenci profili bulunamadı.');
            }

            const ownCoachId = studentDoc.data()?.coachId;
            if (ownCoachId !== coachId) {
                throw new HttpsError('permission-denied', 'Sadece kendi koçunuzu görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        return {
            success: true,
            coach: serializeTimestamps(coachData)
        };
    } catch (error: any) {
        void logError({
            functionName: 'getCoachById',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { coachId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Koç bilgisi alınırken bir hata oluştu.');
    }
});
