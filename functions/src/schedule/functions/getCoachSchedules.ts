import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logError } from "../../log/utils/logError";

export const getCoachSchedules = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    try {
        const { role } = request.auth.token;
        const data = request.data as { coachId?: string };
        let coachId = request.auth.uid;

        if (role === 'admin' || role === 'superadmin') {
            if (!data.coachId) {
                throw new HttpsError('invalid-argument', 'Hoca ID belirtilmesi zorunludur.');
            }
            coachId = data.coachId;
        } else if (role !== 'coach') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        // Hocanın gym bilgisini al → salon tipini belirle + admin yetki kontrolü
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }
        const gymId: string = coachDoc.data()?.gymId;

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!gymId || !adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu hocanın salonuna erişim yetkiniz yok.');
            }
        }

        if (!gymId) {
            throw new HttpsError('failed-precondition', 'Hoca bir salona atanmamış.');
        }

        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        const gymType = gymDoc.data()?.paymentMethod?.type;

        // A TİPİ: Reformer → Appointments getir
        if (gymType === PaymentMethodType.PACKAGE) {
            const snapshot = await db.collection(COLLECTIONS.APPOINTMENTS)
                .where('coachId', '==', coachId)
                .orderBy('date', 'asc')
                .get();

            if (snapshot.empty) {
                return {
                    success: true,
                    scheduleType: 'fixed_dates',
                    appointments: [],
                    message: 'Henüz randevu bulunmuyor.'
                };
            }

            const appointments = snapshot.docs.map(doc => {
                const raw = doc.data();
                return {
                    ...(serializeTimestamps(raw) as Record<string, any>),
                    id: doc.id,
                    studentName: typeof raw.studentName === 'string' ? raw.studentName : ''
                };
            });

            return {
                success: true,
                scheduleType: 'fixed_dates',
                appointments
            };

            // B TİPİ: Klasik → WorkoutSchedules getir
        } else {
            const snapshot = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
                .where('coachId', '==', coachId)
                .where('isActive', '==', true)
                .get();

            if (snapshot.empty) {
                return {
                    success: true,
                    scheduleType: 'weekly_recurring',
                    schedules: [],
                    message: 'Henüz aktif çalışma programı bulunmuyor.'
                };
            }

            const schedules = snapshot.docs.map(doc => {
                const raw = doc.data();
                return {
                    ...(serializeTimestamps(raw) as Record<string, any>),
                    id: doc.id,
                    studentName: typeof raw.studentName === 'string' ? raw.studentName : ''
                };
            });

            return {
                success: true,
                scheduleType: 'weekly_recurring',
                schedules
            };
        }

    } catch (error: any) {
        void logError({
            functionName: 'getCoachSchedules',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: {}
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});