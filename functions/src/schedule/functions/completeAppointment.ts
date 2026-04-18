import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { Appointment } from "../types/schedule.model";
import { PackageSubscription } from "../../subscription/types/subscription.model";
import { SubscriptionStatus } from "../../subscription/types/subscription.enums";
import { GymType } from "../../gym/types/gym.enums";
import { SystemEvent } from "../../notification/types/system-event.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface CompleteAppointmentData {
    appointmentId: string;
}

export const completeAppointment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca yetkisi gereklidir.');
    }

    const data = request.data as CompleteAppointmentData;
    if (!data.appointmentId) {
        throw new HttpsError('invalid-argument', 'Randevu ID zorunludur.');
    }

    try {
        const aptRef = db.collection(COLLECTIONS.APPOINTMENTS).doc(data.appointmentId);

        await db.runTransaction(async (transaction) => {
            const aptDoc = await transaction.get(aptRef);
            if (!aptDoc.exists) {
                throw new HttpsError('not-found', 'Randevu bulunamadı.');
            }

            const apt = aptDoc.data() as Appointment;

            if (role === 'coach' && apt.coachId !== request.auth!.uid) {
                throw new HttpsError('permission-denied', 'Bu randevu size ait değil.');
            }

            // Sadece reformer/randevu bazlı salonlarda completeAppointment kullanılır.
            // Classic salonlarda seans düşürme useSession üzerinden yapılır.
            if (apt.gymId) {
                const gymDoc = await transaction.get(db.collection(COLLECTIONS.GYMS).doc(apt.gymId));
                if (gymDoc.exists && gymDoc.data()?.gymType !== GymType.REFORMER) {
                    throw new HttpsError(
                        'failed-precondition',
                        'Bu salon klasik tip salon. Seans düşürme öğrenci tarafından yapılmalıdır.'
                    );
                }
            }
            if (apt.status !== 'pending') {
                throw new HttpsError(
                    'failed-precondition',
                    `Bu randevu zaten "${apt.status}" durumunda.`
                );
            }

            // Aboneliği getir
            const subRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(apt.subscriptionId);
            const subDoc = await transaction.get(subRef);
            if (!subDoc.exists) {
                throw new HttpsError('not-found', 'Abonelik bulunamadı.');
            }
            const sub = subDoc.data() as PackageSubscription;

            if (sub.sessionsRemaining <= 0) {
                throw new HttpsError('failed-precondition', 'Bu pakette kalan seans yok.');
            }

            const now = admin.firestore.Timestamp.now();
            const newSessionsUsed = sub.sessionsUsed + 1;
            const newSessionsRemaining = sub.sessionsRemaining - 1;
            const totalPackageDebt = sub.totalSessions * sub.pricePerSession;
            const currentBalance = sub.totalPaid - totalPackageDebt;

            // Paket bittiyse aboneliği expired yap
            const newStatus = newSessionsRemaining === 0
                ? SubscriptionStatus.EXPIRED
                : SubscriptionStatus.ACTIVE;

            // Randevuyu güncelle
            transaction.update(aptRef, {
                status: 'completed',
                completedAt: now,
                updatedAt: now
            });

            // Aboneliği güncelle
            transaction.update(subRef, {
                sessionsUsed: newSessionsUsed,
                sessionsRemaining: newSessionsRemaining,
                totalDebt: totalPackageDebt,
                currentBalance,
                status: newStatus,
                updatedAt: now
            });

            // Paket bittiyse öğrencinin activeSubscriptionId'sini temizle
            if (newStatus === SubscriptionStatus.EXPIRED) {
                transaction.update(
                    db.collection(COLLECTIONS.STUDENTS).doc(apt.studentId),
                    { activeSubscriptionId: null, updatedAt: now }
                );
            }

            // Sistem eventi: paket bitti veya az seans kaldı
            const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
            const eventType = newSessionsRemaining === 0
                ? 'package_exhausted'
                : newSessionsRemaining <= 2
                    ? 'package_low'
                    : 'session_completed';

            const event: SystemEvent = {
                id: eventRef.id,
                type: eventType,
                gymId: apt.gymId,
                targetUserId: apt.studentId,
                relatedEntityId: apt.subscriptionId,
                payload: {
                    sessionsRemaining: newSessionsRemaining,
                    sessionNumber: apt.sessionNumber,
                    totalSessions: apt.totalSessions
                },
                createdAt: now,
                notified: false
            };
            transaction.set(eventRef, event);
        });

        const aptSnap = await aptRef.get();
        const aptGymId = aptSnap.data()?.gymId || '';

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
                name: 'Seans tamamlandı'
            },
            gymId: aptGymId,
            details: { appointmentId: data.appointmentId }
        });

        return { success: true, message: 'Seans başarıyla tamamlandı.' };

    } catch (error: any) {
        void logError({
            functionName: 'completeAppointment',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Seans tamamlanırken bir hata oluştu.');
    }
});