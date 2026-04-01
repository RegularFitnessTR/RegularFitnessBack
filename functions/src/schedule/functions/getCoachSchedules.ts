import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
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

            if (role === 'admin') {
                const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
                if (!coachDoc.exists) {
                    throw new HttpsError('not-found', 'Hoca bulunamadı.');
                }
                const coachGymId = coachDoc.data()?.gymId;
                const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
                const adminGymIds: string[] = adminDoc.data()?.gymIds || [];

                if (!coachGymId || !adminGymIds.includes(coachGymId)) {
                    throw new HttpsError('permission-denied', 'Bu hocanın salonuna erişim yetkiniz yok.');
                }
            }
        } else if (role !== 'coach') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        // Hocanın gym bilgisini al → salon tipini belirle
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }
        const gymId: string = coachDoc.data()?.gymId;

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

            // Öğrenci isimlerini getir
            const studentIds = [...new Set(snapshot.docs.map(d => d.data().studentId))];
            const studentMap: Record<string, string> = {};

            await Promise.all(studentIds.map(async (sid) => {
                const sDoc = await db.collection(COLLECTIONS.STUDENTS).doc(sid).get();
                if (sDoc.exists) {
                    const s = sDoc.data()!;
                    studentMap[sid] = `${s.firstName || ''} ${s.lastName || ''}`.trim();
                }
            }));

            const appointments = snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                studentName: studentMap[doc.data().studentId] || ''
            }));

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

            // Öğrenci isimlerini getir
            const studentIds = [...new Set(snapshot.docs.map(d => d.data().studentId))];
            const studentMap: Record<string, string> = {};

            await Promise.all(studentIds.map(async (sid) => {
                const sDoc = await db.collection(COLLECTIONS.STUDENTS).doc(sid).get();
                if (sDoc.exists) {
                    const s = sDoc.data()!;
                    studentMap[sid] = `${s.firstName || ''} ${s.lastName || ''}`.trim();
                }
            }));

            const schedules = snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                studentName: studentMap[doc.data().studentId] || ''
            }));

            return {
                success: true,
                scheduleType: 'weekly_recurring',
                schedules
            };
        }

    } catch (error: any) {
        await logError({
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