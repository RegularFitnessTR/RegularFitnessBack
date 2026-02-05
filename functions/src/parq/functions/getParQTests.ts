import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";

export const getParQTests = onCall(async (request) => {
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

        // Query ParQ tests
        const snapshot = await db.collection(COLLECTIONS.PARQ_TESTS)
            .where('studentId', '==', studentId)
            .orderBy('testDate', 'desc')
            .get();

        const tests = snapshot.docs.map(doc => doc.data());

        return {
            success: true,
            tests: tests,
            count: tests.length
        };

    } catch (error: any) {
        console.error("ParQ testlerini getirme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
