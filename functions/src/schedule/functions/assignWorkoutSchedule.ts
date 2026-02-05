import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { WorkoutSchedule } from "../types/schedule.model";
import { AssignWorkoutScheduleData } from "../types/schedule.dto";
import { validateSessions } from "../utils/validation";

export const assignWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const data = request.data as AssignWorkoutScheduleData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    if (!data.programName || data.programName.trim().length === 0) {
        throw new HttpsError('invalid-argument', 'Program adı belirtilmesi zorunludur.');
    }

    // Validate sessions
    const sessionValidation = validateSessions(data.sessions);
    if (!sessionValidation.valid) {
        throw new HttpsError('invalid-argument', sessionValidation.error || 'Geçersiz seans bilgileri.');
    }

    try {
        // Verify student exists
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();

        // Verify coach is assigned to this student
        if (studentData?.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        // Check if student already has an active schedule
        const existingScheduleQuery = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
            .where('studentId', '==', data.studentId)
            .where('isActive', '==', true)
            .get();

        if (!existingScheduleQuery.empty) {
            throw new HttpsError(
                'already-exists',
                'Bu öğrenci için zaten aktif bir program bulunmaktadır. Önce mevcut programı silin veya pasif hale getirin.'
            );
        }

        const scheduleRef = db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc();
        const scheduleId = scheduleRef.id;

        const newSchedule: WorkoutSchedule = {
            id: scheduleId,
            studentId: data.studentId,
            coachId: request.auth.uid,

            programName: data.programName.trim(),
            programType: data.programType,
            intensity: data.intensity,
            goal: data.goal,

            sessions: data.sessions,

            isActive: true,

            createdBy: request.auth.uid,
            createdAt: admin.firestore.Timestamp.now()
        };

        await scheduleRef.set(newSchedule);

        return {
            success: true,
            message: "Çalışma programı başarıyla atandı.",
            scheduleId: scheduleId
        };

    } catch (error: any) {
        console.error("Program atama hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
