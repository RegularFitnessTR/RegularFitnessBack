import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetStudentByIdData } from "../types/student.dto";

export const getStudentById = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const data = (request.data ?? {}) as GetStudentByIdData;
    const studentId = typeof data.studentId === 'string' ? data.studentId.trim() : '';

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data()!;
        const studentGymId = typeof studentData.gymId === 'string' ? studentData.gymId : '';

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!studentGymId || !adminGymIds.includes(studentGymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrenci kaydına erişim yetkiniz yok.');
            }
        } else if (role === 'coach') {
            if (studentData.coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Sadece kendi öğrencilerinizi görüntüleyebilirsiniz.');
            }
        } else if (role === 'student') {
            if (studentId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Sadece kendi profilinizi görüntüleyebilirsiniz.');
            }
        } else if (role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
        }

        return {
            success: true,
            student: serializeTimestamps(studentData)
        };
    } catch (error: any) {
        void logError({
            functionName: 'getStudentById',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Öğrenci bilgisi alınırken bir hata oluştu.');
    }
});
