import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const assignCoach = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const studentId = request.auth.uid;
    const { coachId } = request.data as { coachId: string };

    if (!coachId) {
        throw new HttpsError('invalid-argument', 'Hoca ID bilgisi eksik.');
    }

    if (studentId === coachId) {
        throw new HttpsError('invalid-argument', 'Kendinizi hoca olarak seçemezsiniz.');
    }

    try {
        // 1. Query from coaches collection
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Belirtilen hoca bulunamadı.');
        }

        const coachData = coachDoc.data();
        if (coachData?.role !== 'coach') {
            throw new HttpsError('invalid-argument', 'Okutulan QR kodu bir hocaya ait değil.');
        }

        // 2. Update student in students collection
        await db.collection(COLLECTIONS.STUDENTS).doc(studentId).update({
            coachId: coachId,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        await logActivity({
            action: LogAction.ASSIGN_COACH,
            category: LogCategory.STUDENT,
            performedBy: {
                uid: studentId,
                role: 'student',
                name: request.auth!.token.name || 'Student'
            },
            targetEntity: {
                id: coachId,
                type: 'coach',
                name: `${coachData.firstName} ${coachData.lastName}`
            },
            gymId: coachData.gymId
        });

        return {
            success: true,
            message: "Hoca başarıyla atandı.",
            coachName: `${coachData.firstName} ${coachData.lastName}`
        };

    } catch (error: any) {
        console.error("Hoca atama hatası:", error);

        await logError({
            functionName: 'assignCoach',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { coachId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Eşleşme sırasında bir hata oluştu.');
    }
});
