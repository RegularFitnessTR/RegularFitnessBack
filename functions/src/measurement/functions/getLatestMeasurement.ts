import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";

export const getLatestMeasurement = onCall(async (request) => {
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
                throw new HttpsError('permission-denied', 'Başka öğrencinin ölçümlerini görüntüleyemezsiniz.');
            }
        } else if (role === 'superadmin') {
            // Superadmin has access to everything
        } else if (role === 'admin' || role === 'coach') {
            const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
            if (!studentDoc.exists) {
                throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
            }
            const studentData = studentDoc.data();

            if (role === 'coach') {
                if (studentData?.coachId !== request.auth.uid) {
                    throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
                }
            } else if (role === 'admin') {
                const gymId = studentData?.gymId;
                if (!gymId) {
                    throw new HttpsError('permission-denied', 'Öğrenci bir spor salonuna atanmamış.');
                }
                
                const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
                const adminData = adminDoc.data();
                const adminGymIds = adminData?.gymIds || [];

                if (!adminGymIds.includes(gymId)) {
                    throw new HttpsError('permission-denied', 'Bu spor salonundaki öğrencileri görüntüleme yetkiniz yok.');
                }
            }
        } else {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        // Get latest measurement
        const snapshot = await db.collection(COLLECTIONS.MEASUREMENTS)
            .where('studentId', '==', studentId)
            .orderBy('measurementDate', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            return {
                success: true,
                measurement: null,
                message: "Henüz ölçüm kaydı bulunmuyor."
            };
        }

        return {
            success: true,
            measurement: snapshot.docs[0].data()
        };

    } catch (error: any) {
        console.error("Son ölçümü getirme hatası:", error);

        await logError({
            functionName: 'getLatestMeasurement',
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
