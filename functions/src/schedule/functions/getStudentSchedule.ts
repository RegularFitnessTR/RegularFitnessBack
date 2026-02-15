import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";

export const getStudentSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        const { role } = request.auth.token;

        // Authorization: Coach (own students) or Student (self)
        if (role === 'student') {
            if (studentId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Başka öğrencinin programını görüntüleyemezsiniz.');
            }
        } else if (role === 'coach') {
            const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
            const studentData = studentDoc.data();

            if (studentData?.coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
            }
        } else {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        // Get active schedule
        const snapshot = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
            .where('studentId', '==', studentId)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return {
                success: true,
                schedule: null,
                message: "Henüz aktif çalışma programı bulunmuyor."
            };
        }

        return {
            success: true,
            schedule: snapshot.docs[0].data()
        };

    } catch (error: any) {
        console.error("Program getirme hatası:", error);

        await logError({
            functionName: 'getStudentSchedule',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
