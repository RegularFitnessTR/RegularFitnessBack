import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { ToggleScheduleStatusData } from "../types/schedule.dto";
import { GymType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const toggleScheduleStatus = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as ToggleScheduleStatusData;

    if (!data.scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID zorunludur.');
    }
    if (data.isActive === undefined) {
        throw new HttpsError('invalid-argument', 'Durum belirtilmesi zorunludur.');
    }

    try {
        const scheduleDoc = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).get();
        if (!scheduleDoc.exists) {
            throw new HttpsError('not-found', 'Program bulunamadı.');
        }

        const schedule = scheduleDoc.data()!;
        const gymId: string = schedule.gymId;

        // Reformer salonunda haftalık şablon yok — bu fonksiyon sadece classic salonlar için
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (gymDoc.data()?.gymType === GymType.REFORMER) {
            throw new HttpsError(
                'failed-precondition',
                'Reformer salonlarda haftalık program durumu değiştirilemez.'
            );
        }

        // Yetki kontrolü
        if (role === 'coach' && schedule.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu programa erişim yetkiniz yok.');
        }

        if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminGymIds: string[] = adminDoc.data()?.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu programın salonuna erişim yetkiniz yok.');
            }
        }

        // Aktif yapılıyorsa başka aktif program var mı kontrol et
        if (data.isActive) {
            const existingActive = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
                .where('studentId', '==', schedule.studentId)
                .where('isActive', '==', true)
                .get();

            const alreadyActiveOther = existingActive.docs.some(d => d.id !== data.scheduleId);
            if (alreadyActiveOther) {
                throw new HttpsError(
                    'already-exists',
                    'Bu öğrenci için zaten başka bir aktif program bulunmaktadır.'
                );
            }
        }

        await db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc(data.scheduleId).update({
            isActive: data.isActive,
            updatedAt: admin.firestore.Timestamp.now()
        });

        await logActivity({
            action: LogAction.TOGGLE_SCHEDULE_STATUS,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,    // sabit 'coach' yerine dinamik
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.scheduleId,
                type: 'schedule',
                name: schedule.programName
            },
            gymId,
            details: { isActive: data.isActive }
        });

        return {
            success: true,
            message: data.isActive ? 'Program aktif hale getirildi.' : 'Program pasif hale getirildi.'
        };

    } catch (error: any) {
        await logError({
            functionName: 'toggleScheduleStatus',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});