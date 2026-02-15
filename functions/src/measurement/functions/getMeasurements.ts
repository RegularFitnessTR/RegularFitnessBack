import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";

export const getMeasurements = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { studentId, limit } = request.data as { studentId: string; limit?: number };

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        const { role } = request.auth.token;

        // Authorization: Coach (own students) or Student (self)
        if (role === 'student') {
            if (studentId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Başka öğrencinin ölçümlerini görüntüleyemezsiniz.');
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

        // Query measurements
        let query = db.collection(COLLECTIONS.MEASUREMENTS)
            .where('studentId', '==', studentId)
            .orderBy('measurementDate', 'desc') as any;

        if (limit) {
            query = query.limit(limit);
        }

        const snapshot = await query.get();
        const measurements = snapshot.docs.map((doc: any) => doc.data());

        return {
            success: true,
            measurements: measurements,
            count: measurements.length
        };

    } catch (error: any) {
        console.error("Ölçümleri getirme hatası:", error);

        await logError({
            functionName: 'getMeasurements',
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
