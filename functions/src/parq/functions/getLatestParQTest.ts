import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";

export const getLatestParQTest = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        const { role } = request.auth.token;

        // Authorization
        if (role === 'student') {
            if (studentId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Başka öğrencinin testlerini görüntüleyemezsiniz.');
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

        // Get latest test
        const snapshot = await db.collection(COLLECTIONS.PARQ_TESTS)
            .where('studentId', '==', studentId)
            .orderBy('testDate', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            return {
                success: true,
                test: null,
                message: "Henüz ParQ testi  bulunmuyor."
            };
        }

        return {
            success: true,
            test: snapshot.docs[0].data()
        };

    } catch (error: any) {
        console.error("Son ParQ testini getirme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
