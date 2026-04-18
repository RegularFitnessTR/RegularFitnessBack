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
    date: string;       // ISO string: "2025-01-08T09:00:00.000Z"
    startTime: string;  // "09:00"
    endTime: string;    // "10:30"
    description?: string;
}

interface CreateAppointmentsData {
    studentId: string;
    subscriptionId: string;
    appointments: AppointmentInput[];
}

export const createAppointments = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Randevu oluşturma yetkisi sadece hocalara aittir.');
    }

    const data = request.data as CreateAppointmentsData;

    if (!data.studentId || !data.subscriptionId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID ve abonelik ID zorunludur.');
    }
    if (!data.appointments || data.appointments.length === 0) {
        throw new HttpsError('invalid-argument', 'En az bir randevu girilmelidir.');
    }
    if (data.appointments.length > 500) {
        throw new HttpsError(
            'invalid-argument',
            'Tek seferde en fazla 500 randevu oluşturulabilir. Lütfen paketi daha küçük parçalara bölün.'
        );
    }

    // Tarih formatı ve startTime/endTime kontrolü
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const apt of data.appointments) {
        if (!apt.date || !apt.startTime || !apt.endTime) {
            throw new HttpsError('invalid-argument', 'Her randevu için tarih, başlangıç ve bitiş saati zorunludur.');
        }
        const aptDate = new Date(apt.date);
        if (isNaN(aptDate.getTime())) {
            throw new HttpsError('invalid-argument', 'Geçersiz tarih formatı.');
        }
        if (aptDate < todayStart) {
            throw new HttpsError('invalid-argument', 'Geçmiş tarihe randevu oluşturulamaz.');
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
        // 1. Öğrenciyi getir
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }
        const studentData = studentDoc.data()!;
        const studentName = `${studentData.firstName || ''} ${studentData.lastName || ''}`.trim();
        let coachName = '';

        // 2. Yetki kontrolü
        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        if (studentData.coachId) {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(studentData.coachId).get();
            if (coachDoc.exists) {
                const coachData = coachDoc.data()!;
                coachName = `${coachData.firstName || ''} ${coachData.lastName || ''}`.trim();
            }
        }

        // 3-5. Transaction: sub re-read + existing count + writes atomik
        const now = admin.firestore.Timestamp.now();
        const incomingCount = data.appointments.length;
        let gymId = '';

        await db.runTransaction(async (tx) => {
            const subRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(data.subscriptionId);
            const subDoc = await tx.get(subRef);

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

            if (!coachName && sub.coachId) {
                const coachDoc = await tx.get(db.collection(COLLECTIONS.COACHES).doc(sub.coachId));
                if (coachDoc.exists) {
                    const coachData = coachDoc.data()!;
                    coachName = `${coachData.firstName || ''} ${coachData.lastName || ''}`.trim();
                }
            }

            const totalSessions = sub.totalSessions;
            gymId = sub.gymId;

            // Counter varsa onu kullan (hızlı yol). Yoksa eski query yöntemiyle hesapla
            // ve subscription'ı bu fırsatla migrate et.
            let existingCount: number;
            const counterAvailable = typeof sub.scheduledSessionsCount === 'number';
            if (counterAvailable) {
                existingCount = sub.scheduledSessionsCount as number;
            } else {
                const existingAptSnap = await tx.get(
                    db.collection(COLLECTIONS.APPOINTMENTS)
                        .where('subscriptionId', '==', data.subscriptionId)
                        .where('status', 'in', ['pending', 'completed', 'postponed'])
                );
                existingCount = existingAptSnap.size;
            }

            const allowedCount = totalSessions - existingCount;

            if (incomingCount !== allowedCount) {
                throw new HttpsError(
                    'invalid-argument',
                    `Bu paket için ${totalSessions} seans planlanmalıdır. ` +
                    `Mevcut: ${existingCount}, Eklenecek: ${incomingCount}, ` +
                    `Gereken: ${allowedCount}. Lütfen tam olarak ${allowedCount} randevu girin.`
                );
            }

            data.appointments.forEach((apt, index) => {
                const aptRef = db.collection(COLLECTIONS.APPOINTMENTS).doc();
                const newAppointment: Appointment = {
                    id: aptRef.id,
                    studentId: data.studentId,
                    studentName,
                    coachId: sub.coachId,
                    coachName: coachName || undefined,
                    gymId,
                    subscriptionId: data.subscriptionId,
                    sessionNumber: existingCount + index + 1,
                    totalSessions,
                    date: admin.firestore.Timestamp.fromDate(new Date(apt.date)),
                    startTime: apt.startTime,
                    endTime: apt.endTime,
                    description: apt.description,
                    status: 'pending',
                    createdBy: request.auth!.uid,
                    createdAt: now
                };
                tx.set(aptRef, newAppointment);
            });

            // Counter güncelle: varsa atomik increment, yoksa fırsattan istifade absolute set
            if (counterAvailable) {
                tx.update(subRef, {
                    scheduledSessionsCount: admin.firestore.FieldValue.increment(incomingCount),
                    updatedAt: now,
                });
            } else {
                tx.update(subRef, {
                    scheduledSessionsCount: existingCount + incomingCount,
                    updatedAt: now,
                });
            }
        });

        void logActivity({
            action: LogAction.ASSIGN_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.subscriptionId,
                type: 'schedule',
                name: `${incomingCount} randevu`
            },
            gymId,
            details: { studentId: data.studentId, subscriptionId: data.subscriptionId, count: incomingCount }
        });

        return {
            success: true,
            message: `${incomingCount} randevu başarıyla oluşturuldu.`,
            count: incomingCount
        };

    } catch (error: any) {
        void logError({
            functionName: 'createAppointments',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: { studentId: data.studentId, subscriptionId: data.subscriptionId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Randevular oluşturulurken bir hata oluştu.');
    }
});