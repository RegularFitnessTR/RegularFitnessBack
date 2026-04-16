import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logError } from "../../log/utils/logError";

export const getStudentSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }

    try {
        // Yetki kontrolü
        if (role === 'student' && studentId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Başka öğrencinin programını görüntüleyemezsiniz.');
        }

        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data()!;
        const gymId: string = studentData.gymId;

        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!gymId || !adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrencinin salonuna erişim yetkiniz yok.');
            }
        }

        // Salon tipini belirle
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        const gymType = gymDoc.data()?.paymentMethod?.type;

        // A TİPİ: Reformer / Paket bazlı → Appointment listesi döndür
        if (gymType === PaymentMethodType.PACKAGE) {
            const activeSubscriptionId = studentData.activeSubscriptionId;

            if (!activeSubscriptionId) {
                return {
                    success: true,
                    scheduleType: 'fixed_dates',
                    appointments: [],
                    message: 'Aktif paket aboneliği yok.'
                };
            }

            // Tüm durumları getir, frontend filtrelesin
            const appointmentsBaseQuery = db.collection(COLLECTIONS.APPOINTMENTS)
                .where('subscriptionId', '==', activeSubscriptionId);

            const appointmentsQuery = await appointmentsBaseQuery
                .orderBy('sessionNumber', 'asc')
                .get();

            const appointments = appointmentsQuery.docs.map(d => d.data());

            // Özet bilgileri Firestore aggregation ile hesapla
            const [pendingCount, completedCount, cancelledCount] = await Promise.all([
                appointmentsBaseQuery.where('status', '==', 'pending').count().get(),
                appointmentsBaseQuery.where('status', '==', 'completed').count().get(),
                appointmentsBaseQuery.where('status', '==', 'cancelled').count().get(),
            ]);

            return {
                success: true,
                scheduleType: 'fixed_dates',
                appointments,
                summary: {
                    total: appointmentsQuery.size,
                    pending: pendingCount.data().count,
                    completed: completedCount.data().count,
                    cancelled: cancelledCount.data().count,
                }
            };

            // B TİPİ: Klasik / Üyelik bazlı → WorkoutSchedule döndür
        } else {
            const scheduleQuery = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
                .where('studentId', '==', studentId)
                .where('isActive', '==', true)
                .limit(1)
                .get();

            if (scheduleQuery.empty) {
                return {
                    success: true,
                    scheduleType: 'weekly_recurring',
                    schedule: null,
                    message: 'Aktif haftalık program yok.'
                };
            }

            return {
                success: true,
                scheduleType: 'weekly_recurring',
                schedule: scheduleQuery.docs[0].data()
            };
        }

    } catch (error: any) {
        await logError({
            functionName: 'getStudentSchedule',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});