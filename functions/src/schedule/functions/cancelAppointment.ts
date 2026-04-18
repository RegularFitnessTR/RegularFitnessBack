import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
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
        const now = admin.firestore.Timestamp.now();

        // Appointment iptal + subscription counter decrement'i atomik yap.
        const apt = await db.runTransaction(async (tx) => {
            const aptDoc = await tx.get(aptRef);
            if (!aptDoc.exists) {
                throw new HttpsError('not-found', 'Randevu bulunamadı.');
            }
            const aptData = aptDoc.data() as Appointment;

            if (role === 'coach' && aptData.coachId !== request.auth!.uid) {
                throw new HttpsError('permission-denied', 'Bu randevu size ait değil.');
            }
            if (aptData.status === 'completed') {
                throw new HttpsError(
                    'failed-precondition',
                    'Tamamlanmış randevular iptal edilemez.'
                );
            }
            if (aptData.status === 'cancelled') {
                throw new HttpsError(
                    'failed-precondition',
                    'Bu randevu zaten iptal edilmiş.'
                );
            }

            // Randevuyu iptal et — paketten seans DÜŞMEZ
            tx.update(aptRef, {
                status: 'cancelled',
                cancelledAt: now,
                cancellationReason: data.reason || '',
                updatedAt: now,
            });

            // scheduledSessionsCount: pending/postponed slotlar sayılıyor. Cancelled sayılmıyor.
            // Dolayısıyla pending/postponed → cancelled transition'ında counter -1.
            // Counter yoksa dokunma (migration sonrası düzelir).
            if (aptData.subscriptionId && (aptData.status === 'pending' || aptData.status === 'postponed')) {
                const subRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(aptData.subscriptionId);
                const subDoc = await tx.get(subRef);
                if (subDoc.exists && typeof subDoc.data()?.scheduledSessionsCount === 'number') {
                    tx.update(subRef, {
                        scheduledSessionsCount: admin.firestore.FieldValue.increment(-1),
                        updatedAt: now,
                    });
                }
            }

            return aptData;
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
            action: LogAction.USE_SESSION,
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
        void logError({
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