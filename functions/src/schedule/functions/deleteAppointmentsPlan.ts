import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription } from "../../subscription/types/subscription.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface DeleteAppointmentsPlanData {
    studentId: string;
    subscriptionId: string;
}

export const deleteAppointmentsPlan = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca yetkisi gereklidir.');
    }

    const data = request.data as DeleteAppointmentsPlanData;
    if (!data.studentId || !data.subscriptionId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID ve abonelik ID zorunludur.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }
        const studentData = studentDoc.data()!;

        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        const subDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(data.subscriptionId).get();
        if (!subDoc.exists) {
            throw new HttpsError('not-found', 'Abonelik bulunamadı.');
        }
        const sub = subDoc.data() as PackageSubscription;

        if (sub.studentId !== data.studentId) {
            throw new HttpsError('invalid-argument', 'Abonelik bu öğrenciye ait değil.');
        }
        if (sub.type !== PaymentMethodType.PACKAGE) {
            throw new HttpsError(
                'failed-precondition',
                'Bu işlem sadece paket bazlı abonelikler için kullanılabilir.'
            );
        }

        const existingAppointments = await db.collection(COLLECTIONS.APPOINTMENTS)
            .where('subscriptionId', '==', data.subscriptionId)
            .get();

        if (existingAppointments.empty) {
            return {
                success: true,
                message: 'Silinecek randevu planı bulunamadı.',
                deletedCount: 0
            };
        }

        const completedCount = existingAppointments.docs.filter(
            (doc) => doc.data().status === 'completed'
        ).length;

        if (completedCount > 0) {
            throw new HttpsError(
                'failed-precondition',
                `Tamamlanmış ${completedCount} seans olduğu için program tamamen silinemez. ` +
                'Önce kalan seansları toplu güncelleyin.'
            );
        }

        // scheduledSessionsCount: cancelled olanlar zaten sayılmıyordu.
        // Silinenlerden sadece non-cancelled olanları counter'dan düş.
        const nonCancelledDeletedCount = existingAppointments.docs.filter(
            (doc) => doc.data().status !== 'cancelled'
        ).length;

        if (nonCancelledDeletedCount > 0 && typeof sub.scheduledSessionsCount !== 'number') {
            throw new HttpsError(
                'failed-precondition',
                'Abonelik seans sayacı eksik. Lütfen aboneliği yeniden oluşturun.'
            );
        }

        const batch = db.batch();
        existingAppointments.docs.forEach((doc) => batch.delete(doc.ref));

        if (nonCancelledDeletedCount > 0) {
            batch.update(
                db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(data.subscriptionId),
                {
                    scheduledSessionsCount: admin.firestore.FieldValue.increment(
                        -nonCancelledDeletedCount
                    ),
                    updatedAt: admin.firestore.Timestamp.now(),
                }
            );
        }

        await batch.commit();

        void logActivity({
            action: LogAction.DELETE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: {
                id: data.subscriptionId,
                type: 'schedule',
                name: 'Randevu planı tamamen silindi'
            },
            gymId: sub.gymId,
            details: {
                studentId: data.studentId,
                subscriptionId: data.subscriptionId,
                deletedCount: existingAppointments.size
            }
        });

        return {
            success: true,
            message: `${existingAppointments.size} randevu başarıyla silindi.`,
            deletedCount: existingAppointments.size
        };
    } catch (error: any) {
        void logError({
            functionName: 'deleteAppointmentsPlan',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Randevu planı silinirken bir hata oluştu.');
    }
});