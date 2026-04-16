import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { Appointment } from "../types/schedule.model";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription } from "../../subscription/types/subscription.model";
import { SubscriptionStatus } from "../../subscription/types/subscription.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface AppointmentInput {
    date: string;
    startTime: string;
    endTime: string;
    description?: string;
}

interface UpdateAppointmentsPlanData {
    studentId: string;
    subscriptionId: string;
    appointments: AppointmentInput[];
}

export const updateAppointmentsPlan = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca yetkisi gereklidir.');
    }

    const data = request.data as UpdateAppointmentsPlanData;

    if (!data.studentId || !data.subscriptionId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID ve abonelik ID zorunludur.');
    }
    if (!data.appointments || data.appointments.length === 0) {
        throw new HttpsError('invalid-argument', 'En az bir randevu girilmelidir.');
    }

    const todayStartForUpdate = new Date();
    todayStartForUpdate.setHours(0, 0, 0, 0);

    for (const apt of data.appointments) {
        if (!apt.date || !apt.startTime || !apt.endTime) {
            throw new HttpsError('invalid-argument', 'Her randevu için tarih, başlangıç ve bitiş saati zorunludur.');
        }

        const parsedDate = new Date(apt.date);
        if (Number.isNaN(parsedDate.getTime())) {
            throw new HttpsError('invalid-argument', 'Randevu tarihi geçerli bir ISO tarih olmalıdır.');
        }
        if (parsedDate < todayStartForUpdate) {
            throw new HttpsError('invalid-argument', 'Geçmiş tarihe randevu planlanamaz.');
        }

        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(apt.startTime) || !timeRegex.test(apt.endTime)) {
            throw new HttpsError('invalid-argument', 'Saat formatı HH:mm olmalıdır.');
        }
        if (apt.startTime >= apt.endTime) {
            throw new HttpsError('invalid-argument', 'Başlangıç saati bitiş saatinden önce olmalıdır.');
        }
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
                'Randevu sistemi sadece paket bazlı abonelikler için kullanılabilir.'
            );
        }
        if (sub.status !== SubscriptionStatus.ACTIVE) {
            throw new HttpsError('failed-precondition', 'Abonelik aktif değil.');
        }

        const existingAppointments = await db.collection(COLLECTIONS.APPOINTMENTS)
            .where('subscriptionId', '==', data.subscriptionId)
            .orderBy('sessionNumber', 'asc')
            .get();

        const completedAppointments = existingAppointments.docs.filter(
            (doc) => doc.data().status === 'completed'
        );
        const editableAppointments = existingAppointments.docs.filter(
            (doc) => doc.data().status !== 'completed'
        );

        const reservedSessionNumbers = new Set<number>(
            completedAppointments.map((doc) => (doc.data() as Appointment).sessionNumber)
        );

        const availableSessionNumbers: number[] = [];
        for (let i = 1; i <= sub.totalSessions; i++) {
            if (!reservedSessionNumbers.has(i)) {
                availableSessionNumbers.push(i);
            }
        }

        if (availableSessionNumbers.length === 0) {
            throw new HttpsError(
                'failed-precondition',
                'Tüm seanslar tamamlandığı için güncellenecek plan bulunmuyor.'
            );
        }

        if (data.appointments.length !== availableSessionNumbers.length) {
            throw new HttpsError(
                'invalid-argument',
                `Bu paket için kalan ${availableSessionNumbers.length} seans planlanmalıdır. ` +
                `Gönderilen: ${data.appointments.length}.`
            );
        }

        const batch = db.batch();
        const now = admin.firestore.Timestamp.now();

        editableAppointments.forEach((doc) => batch.delete(doc.ref));

        data.appointments.forEach((apt, index) => {
            const aptRef = db.collection(COLLECTIONS.APPOINTMENTS).doc();
            const newAppointment: Appointment = {
                id: aptRef.id,
                studentId: data.studentId,
                coachId: sub.coachId,
                gymId: sub.gymId,
                subscriptionId: data.subscriptionId,
                sessionNumber: availableSessionNumbers[index],
                totalSessions: sub.totalSessions,
                date: admin.firestore.Timestamp.fromDate(new Date(apt.date)),
                startTime: apt.startTime,
                endTime: apt.endTime,
                description: apt.description,
                status: 'pending',
                createdBy: request.auth!.uid,
                createdAt: now,
                updatedAt: now
            };
            batch.set(aptRef, newAppointment);
        });

        await batch.commit();

        await logActivity({
            action: LogAction.UPDATE_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: {
                id: data.subscriptionId,
                type: 'schedule',
                name: 'Randevu planı toplu güncellendi'
            },
            gymId: sub.gymId,
            details: {
                studentId: data.studentId,
                subscriptionId: data.subscriptionId,
                completedLockedCount: completedAppointments.length,
                replacedCount: editableAppointments.length,
                newCount: data.appointments.length
            }
        });

        return {
            success: true,
            message: 'Randevu planı başarıyla güncellendi.',
            completedLockedCount: completedAppointments.length,
            replacedCount: editableAppointments.length,
            newCount: data.appointments.length
        };
    } catch (error: any) {
        await logError({
            functionName: 'updateAppointmentsPlan',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: {
                studentId: data.studentId,
                subscriptionId: data.subscriptionId,
                appointmentsCount: data.appointments?.length || 0
            }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Randevu planı güncellenirken bir hata oluştu.');
    }
});