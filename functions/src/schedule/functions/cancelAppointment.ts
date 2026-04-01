import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { Appointment } from "../types/schedule.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { SystemEvent } from "../../notification/types/system-event.model";

interface CancelAppointmentData {
    appointmentId: string;
    reason?: string;
}

export const cancelAppointment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca yetkisi gereklidir.');
    }

    const data = request.data as CancelAppointmentData;
    if (!data.appointmentId) {
        throw new HttpsError('invalid-argument', 'Randevu ID zorunludur.');
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

        if (apt.status === 'completed') {
            throw new HttpsError(
                'failed-precondition',
                'Tamamlanmış randevular iptal edilemez.'
            );
        }

        if (apt.status === 'cancelled') {
            throw new HttpsError(
                'failed-precondition',
                'Bu randevu zaten iptal edilmiş.'
            );
        }

        const now = admin.firestore.Timestamp.now();

        // Randevuyu iptal et — paketten seans DÜŞMEZ
        await aptRef.update({
            status: 'cancelled',
            cancelledAt: now,
            cancellationReason: data.reason || '',
            updatedAt: now
        });

        // Sistem eventi yaz
        const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
        const event: SystemEvent = {
            id: eventRef.id,
            type: 'session_postponed',
            gymId: apt.gymId,
            targetUserId: apt.studentId,
            relatedEntityId: data.appointmentId,
            payload: {
                appointmentId: data.appointmentId,
                sessionNumber: apt.sessionNumber,
                reason: data.reason || '',
                originalDate: apt.date
            },
            createdAt: now,
            notified: false
        };
        await eventRef.set(event);

        await logActivity({
            action: LogAction.ASSIGN_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.appointmentId,
                type: 'schedule',
                name: 'Seans iptal edildi'
            },
            gymId: apt.gymId,
            details: {
                appointmentId: data.appointmentId,
                sessionNumber: apt.sessionNumber,
                reason: data.reason
            }
        });

        return { success: true, message: 'Randevu başarıyla iptal edildi.' };

    } catch (error: any) {
        await logError({
            functionName: 'cancelAppointment',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Randevu iptal edilirken bir hata oluştu.');
    }
});