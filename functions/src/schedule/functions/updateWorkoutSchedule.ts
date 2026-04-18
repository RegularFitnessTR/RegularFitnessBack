import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { UpdateWorkoutScheduleData } from "../types/schedule.dto";
import { validateSessions } from "../utils/validation";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const updateWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const allowedRoles = ['coach', 'admin', 'superadmin', 'student'];
    if (!allowedRoles.includes(role)) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as UpdateWorkoutScheduleData;
    if (!data.scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID zorunludur.');
    }

    try {
        const scheduleDoc = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).get();
        if (!scheduleDoc.exists) {
            throw new HttpsError('not-found', 'Program bulunamadı.');
        }

        const schedule = scheduleDoc.data()!;
        const gymId: string = schedule.gymId;

        // Salon tipi kontrolü — reformer salonunda haftalık şablon güncellenemez
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (gymDoc.data()?.paymentMethod?.type === PaymentMethodType.PACKAGE) {
            throw new HttpsError(
                'failed-precondition',
                'Paket bazlı salonlarda haftalık program yerine randevu sistemi kullanılmaktadır.'
            );
        }

        // Yetki kontrolü
        if (role === 'coach' && schedule.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
        }

        // Öğrenci sadece kendi programını güncelleyebilir
        if (role === 'student' && schedule.studentId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Sadece kendi programınızı güncelleyebilirsiniz.');
        }

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu programın salonuna erişim yetkiniz yok.');
            }
        }

        const updates: Record<string, any> = {
            updatedAt: admin.firestore.Timestamp.now()
        };

        if (data.programName !== undefined) {
            if (data.programName.trim().length === 0) {
                throw new HttpsError('invalid-argument', 'Program adı boş olamaz.');
            }
            updates.programName = data.programName.trim();
        }

        if (data.programType !== undefined) updates.programType = data.programType;
        if (data.intensity !== undefined) updates.intensity = data.intensity;
        if (data.goal !== undefined) updates.goal = data.goal;

        if (data.sessions !== undefined) {
            const sessionValidation = validateSessions(data.sessions);
            if (!sessionValidation.valid) {
                throw new HttpsError('invalid-argument', sessionValidation.error || 'Geçersiz seans bilgileri.');
            }
            updates.sessions = data.sessions;
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).update(updates);

        void logActivity({
            action: LogAction.UPDATE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.scheduleId,
                type: 'schedule',
                name: schedule.programName
            },
            gymId,
            details: { updatedFields: Object.keys(updates) }
        });

        return { success: true, message: 'Çalışma programı başarıyla güncellendi.' };

    } catch (error: any) {
        void logError({
            functionName: 'updateWorkoutSchedule',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});