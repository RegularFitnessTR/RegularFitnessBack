import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { UpdateWorkoutScheduleData } from "../types/schedule.dto";
import { validateSessions } from "../utils/validation";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const updateWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const data = request.data as UpdateWorkoutScheduleData;

    if (!data.scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID belirtilmesi zorunludur.');
    }

    try {
        const scheduleDoc = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).get();

        if (!scheduleDoc.exists) {
            throw new HttpsError('not-found', 'Program bulunamadı.');
        }

        const schedule = scheduleDoc.data();

        // Verify coach owns this schedule
        if (schedule?.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
        }

        const updates: any = {
            updatedAt: admin.firestore.Timestamp.now()
        };

        if (data.programName !== undefined) {
            if (data.programName.trim().length === 0) {
                throw new HttpsError('invalid-argument', 'Program adı boş olamaz.');
            }
            updates.programName = data.programName.trim();
        }

        if (data.programType !== undefined) {
            updates.programType = data.programType;
        }

        if (data.intensity !== undefined) {
            updates.intensity = data.intensity;
        }

        if (data.goal !== undefined) {
            updates.goal = data.goal;
        }

        if (data.sessions !== undefined) {
            const sessionValidation = validateSessions(data.sessions);
            if (!sessionValidation.valid) {
                throw new HttpsError('invalid-argument', sessionValidation.error || 'Geçersiz seans bilgileri.');
            }
            updates.sessions = data.sessions;
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).update(updates);

        // Log kaydı
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(request.auth!.uid).get();
        const coachGymId = coachDoc.data()?.gymId;

        await logActivity({
            action: LogAction.UPDATE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: 'coach',
                name: request.auth!.token.name || 'Coach'
            },
            targetEntity: {
                id: data.scheduleId,
                type: 'schedule',
                name: schedule?.programName
            },
            gymId: coachGymId,
            details: { updatedFields: Object.keys(updates) }
        });

        return {
            success: true,
            message: "Çalışma programı başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Program güncelleme hatası:", error);

        await logError({
            functionName: 'updateWorkoutSchedule',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
