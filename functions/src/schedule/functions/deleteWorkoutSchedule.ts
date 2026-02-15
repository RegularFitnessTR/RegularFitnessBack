import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const deleteWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const { scheduleId } = request.data;

    if (!scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID belirtilmesi zorunludur.');
    }

    try {
        const scheduleDoc = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(scheduleId).get();

        if (!scheduleDoc.exists) {
            throw new HttpsError('not-found', 'Program bulunamadı.');
        }

        const schedule = scheduleDoc.data();

        // Verify coach owns this schedule
        if (schedule?.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(scheduleId).delete();

        // Log kaydı
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth!.uid).get();
        const coachGymId = coachDoc.data()?.gymId;

        await logActivity({
            action: LogAction.DELETE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: 'coach',
                name: request.auth!.token.name || 'Coach'
            },
            targetEntity: {
                id: scheduleId,
                type: 'schedule',
                name: schedule?.programName
            },
            gymId: coachGymId
        });

        return {
            success: true,
            message: "Çalışma programı başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Program silme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
