import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";

function mapUnexpectedMeasurementError(error: any): HttpsError {
    const rawCode = String(error?.code ?? '').toLowerCase();
    const rawMessage = String(error?.message ?? '');

    if (rawCode.includes('failed-precondition') || rawCode === '9') {
        return new HttpsError('failed-precondition', 'Ölçüm sorgusu için gerekli Firestore indexi eksik veya hazır değil.');
    }

    if (rawCode.includes('permission-denied') || rawCode === '7') {
        return new HttpsError('permission-denied', 'Ölçüm verilerine erişim izni bulunamadı.');
    }

    if (rawCode.includes('unavailable') || rawCode === '14') {
        return new HttpsError('unavailable', 'Ölçüm servisi geçici olarak kullanılamıyor.');
    }

    // Firestore missing-index hataları bazen mesaj tabanlı gelir.
    if (/index/i.test(rawMessage) && /create/i.test(rawMessage)) {
        return new HttpsError('failed-precondition', 'Ölçüm sorgusu için gerekli Firestore indexi eksik veya hazır değil.');
    }

    return new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
}

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

                const adminGymIds: string[] = request.auth.token.gymIds || [];
                if (!adminGymIds.includes(gymId)) {
                    throw new HttpsError('permission-denied', 'Bu spor salonundaki öğrencileri görüntüleme yetkiniz yok.');
                }
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
        const measurements = snapshot.docs.map((doc: any) => serializeTimestamps(doc.data()));

        return {
            success: true,
            measurements: measurements,
            count: measurements.length
        };

    } catch (error: any) {
        console.error("Ölçümleri getirme hatası:", error);

        void logError({
            functionName: 'getMeasurements',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw mapUnexpectedMeasurementError(error);
    }
});
