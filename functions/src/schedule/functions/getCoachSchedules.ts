import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
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
                const doc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
                if (!doc.exists) {
                    throw new HttpsError('not-found', 'Hoca bulunamadı.');
                }
                const coachData = doc.data();
                const coachGymId = coachData?.gymId;

                const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
                const adminData = adminDoc.data();
                const adminGymIds = adminData?.gymIds || [];

                if (!coachGymId || !adminGymIds.includes(coachGymId)) {
                    throw new HttpsError('permission-denied', 'Bu hocanın spor salonuna erişim yetkiniz yok.');
                }
            }
        } else if (role !== 'coach') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        // Get all active schedules for this coach
        const snapshot = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
            .where('coachId', '==', coachId)
            .where('isActive', '==', true)
            .get();

        if (snapshot.empty) {
            return {
                success: true,
                schedules: [],
                message: "Henüz aktif çalışma programı bulunmuyor."
            };
        }

        const schedules = [];

        // Fetch student names for each schedule
        for (const doc of snapshot.docs) {
            const data = doc.data();
            let studentName = "";

            if (data.studentId) {
                const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();
                if (studentDoc.exists) {
                    const sData = studentDoc.data();
                    studentName = `${sData?.firstName || ''} ${sData?.lastName || ''}`.trim();
                }
            }

            schedules.push({
                ...data,
                id: doc.id,
                studentName
            });
        }

        return {
            success: true,
            schedules
        };

    } catch (error: any) {
        console.error("Coach program getirme hatası:", error);

        await logError({
            functionName: 'getCoachSchedules',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: {}
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
