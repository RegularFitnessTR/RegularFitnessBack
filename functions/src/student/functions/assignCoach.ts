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
    const { qrCodeString } = request.data as { qrCodeString: string };

    if (!qrCodeString) {
        throw new HttpsError('invalid-argument', 'QR kod bilgisi eksik.');
    }

    try {
        // 1. Query from coaches collection using qrCodeString
        const coachesSnapshot = await db.collection(COLLECTIONS.COACHES).where('qrCodeString', '==', qrCodeString).limit(1).get();

        if (coachesSnapshot.empty) {
            throw new HttpsError('not-found', 'Belirtilen QR koda sahip hoca bulunamadı.');
        }

        const coachDoc = coachesSnapshot.docs[0];
        const coachId = coachDoc.id;
        const coachData = coachDoc.data();

        if (studentId === coachId) {
            throw new HttpsError('invalid-argument', 'Kendinizi hoca olarak seçemezsiniz.');
        }

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
            requestData: { qrCodeString }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Eşleşme sırasında bir hata oluştu.');
    }
});
