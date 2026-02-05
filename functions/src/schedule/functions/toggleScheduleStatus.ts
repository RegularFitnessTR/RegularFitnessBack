import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { ToggleScheduleStatusData } from "../types/schedule.dto";

export const toggleScheduleStatus = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const data = request.data as ToggleScheduleStatusData;

    if (!data.scheduleId) {
        throw new HttpsError('invalid-argument', 'Program ID belirtilmesi zorunludur.');
    }

    if (data.isActive === undefined) {
        throw new HttpsError('invalid-argument', 'Durum belirtilmesi zorunludur.');
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

        // If activating, check for other active schedules
        if (data.isActive) {
            const existingActive = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
                .where('studentId', '==', schedule?.studentId)
                .where('isActive', '==', true)
                .get();

            if (!existingActive.empty && existingActive.docs[0].id !== data.scheduleId) {
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

        return {
            success: true,
            message: data.isActive ? "Program aktif hale getirildi." : "Program pasif hale getirildi."
        };

    } catch (error: any) {
        console.error("Program durum değiştirme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
