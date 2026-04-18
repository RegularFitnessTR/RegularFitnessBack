import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { Appointment } from "../types/schedule.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface PostponeAppointmentData {
    appointmentId: string;
    newDate: string;      // ISO string
    newStartTime: string; // "09:00"
    newEndTime: string;   // "10:30"
    reason?: string;
}

export const postponeAppointment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca yetkisi gereklidir.');
    }

    const data = request.data as PostponeAppointmentData;
    if (!data.appointmentId || !data.newDate || !data.newStartTime || !data.newEndTime) {
        throw new HttpsError('invalid-argument', 'Randevu ID, yeni tarih ve saatler zorunludur.');
    }

    const newDateParsed = new Date(data.newDate);
    if (isNaN(newDateParsed.getTime())) {
        throw new HttpsError('invalid-argument', 'Geçersiz tarih formatı.');
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (newDateParsed < todayStart) {
        throw new HttpsError('invalid-argument', 'Geçmiş tarihe randevu ertelenemiyor.');
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(data.newStartTime) || !timeRegex.test(data.newEndTime)) {
        throw new HttpsError('invalid-argument', 'Saat formatı HH:mm olmalıdır.');
    }
    if (data.newStartTime >= data.newEndTime) {
        throw new HttpsError('invalid-argument', 'Başlangıç saati bitiş saatinden önce olmalıdır.');
    }

    try {
        const aptRef = db.collection(COLLECTIONS.APPOINTMENTS).doc(data.appointmentId);
        const aptDoc = await aptRef.get();

        if (!aptDoc.exists) {
            throw new HttpsError('not-found', 'Randevu bulunamadı.');
        }

        const apt = aptDoc.data() as Appointment;

        if (role === 'coach' && apt.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu randevu size ait değil.');
        }
        if (apt.status !== 'pending') {
            throw new HttpsError(
                'failed-precondition',
                `Sadece bekleyen randevular ertelenebilir. Mevcut durum: "${apt.status}".`
            );
        }

        const now = admin.firestore.Timestamp.now();

        await aptRef.update({
            postponedAt: now,
            postponedFrom: apt.date,  // orijinal tarihi sakla
            date: admin.firestore.Timestamp.fromDate(new Date(data.newDate)),
            startTime: data.newStartTime,
            endTime: data.newEndTime,
            cancellationReason: data.reason || '',
            status: 'pending',        // ertelenen randevu tekrar bekliyor durumuna döner
            updatedAt: now
        });

        void logActivity({
            action: LogAction.UPDATE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.appointmentId,
                type: 'schedule',
                name: 'Seans ertelendi'
            },
            gymId: apt.gymId,
            details: {
                appointmentId: data.appointmentId,
                originalDate: apt.date,
                newDate: data.newDate
            }
        });

        return { success: true, message: 'Randevu başarıyla ertelendi.' };

    } catch (error: any) {
        void logError({
            functionName: 'postponeAppointment',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Randevu ertelenirken bir hata oluştu.');
    }
});