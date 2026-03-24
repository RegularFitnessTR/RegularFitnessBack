import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const deleteWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar, adminler ve superadminler tarafından yapılabilir.');
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
        const scheduleGymId = schedule?.gymId;

        // Authorization check
        if (role === 'coach') {
            if (schedule?.coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
            }
        } else if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminData = adminDoc.data();
            const adminGymIds = adminData?.gymIds || [];

            if (!scheduleGymId || !adminGymIds.includes(scheduleGymId)) {
                throw new HttpsError('permission-denied', 'Bu programın spor salonuna erişim yetkiniz yok.');
            }
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(scheduleId).delete();

        // Log kaydı


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
            gymId: scheduleGymId
        });

        return {
            success: true,
            message: "Çalışma programı başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Program silme hatası:", error);

        await logError({
            functionName: 'deleteWorkoutSchedule',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { scheduleId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
