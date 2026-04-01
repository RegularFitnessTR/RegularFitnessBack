import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const deleteWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const allowedRoles = ['coach', 'admin', 'superadmin', 'student'];
    if (!allowedRoles.includes(role)) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const { scheduleId } = request.data;
    if (!scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID zorunludur.');
    }

    try {
        const scheduleDoc = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(scheduleId).get();
        if (!scheduleDoc.exists) {
            throw new HttpsError('not-found', 'Program bulunamadı.');
        }

        const schedule = scheduleDoc.data()!;
        const gymId: string = schedule.gymId;

        // Salon tipi kontrolü — reformer salonunda bu fonksiyon kullanılamaz
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (gymDoc.data()?.paymentMethod?.type === PaymentMethodType.PACKAGE) {
            throw new HttpsError(
                'failed-precondition',
                'Paket bazlı salonlarda randevular cancelAppointment ile iptal edilmelidir.'
            );
        }

        // Yetki kontrolü
        if (role === 'coach' && schedule.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
        }

        if (role === 'student' && schedule.studentId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Sadece kendi programınızı silebilirsiniz.');
        }

        if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminGymIds: string[] = adminDoc.data()?.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu programın salonuna erişim yetkiniz yok.');
            }
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(scheduleId).delete();

        await logActivity({
            action: LogAction.DELETE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: scheduleId,
                type: 'schedule',
                name: schedule.programName
            },
            gymId
        });

        return { success: true, message: 'Çalışma programı başarıyla silindi.' };

    } catch (error: any) {
        await logError({
            functionName: 'deleteWorkoutSchedule',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: { scheduleId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});