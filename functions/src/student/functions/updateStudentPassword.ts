import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UpdateStudentPasswordData } from "../types/student.dto";

export const updateStudentPassword = onCall(async (request) => {
    // Student updates their own password
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece öğrenciler tarafından yapılabilir.');
    }

    const studentUid = request.auth.uid;
    const data = request.data as UpdateStudentPasswordData;

    if (!data.newPassword || data.newPassword.length < 6) {
        throw new HttpsError('invalid-argument', 'Yeni şifre en az 6 karakter olmalıdır.');
    }

    try {
        // Verify student exists
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentUid).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci kaydı bulunamadı.');
        }

        const studentData = studentDoc.data();

        // Firebase Auth updates password
        await auth.updateUser(studentUid, { password: data.newPassword });

        // Log kaydı
        await logActivity({
            action: LogAction.UPDATE_STUDENT_PASSWORD,
            category: LogCategory.STUDENT,
            performedBy: {
                uid: studentUid,
                role: 'student',
                name: `${studentData?.firstName} ${studentData?.lastName}`
            },
            targetEntity: {
                id: studentUid,
                type: 'student',
                name: `${studentData?.firstName} ${studentData?.lastName}`
            },
            gymId: studentData?.gymId || undefined
        });

        return {
            success: true,
            message: "Şifreniz başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Öğrenci şifre güncelleme hatası:", error);

        void logError({
            functionName: 'updateStudentPassword',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: {
                // mask password on logs
                newPassword: '***'
            }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
