import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db } from "../firebase";

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
        const coachDoc = await db.collection('users').doc(coachId).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Belirtilen hoca bulunamadı.');
        }

        const coachData = coachDoc.data();
        if (coachData?.role !== 'coach') {
            throw new HttpsError('invalid-argument', 'Okutulan QR kodu bir hocaya ait değil.');
        }

        await db.collection('users').doc(studentId).update({
            coachId: coachId,
            updatedAt: admin.firestore.Timestamp.now()
        });

        return {
            success: true,
            message: "Hoca başarıyla atandı.",
            coachName: `${coachData.firstName} ${coachData.lastName}`
        };

    } catch (error: any) {
        console.error("Hoca atama hatası:", error);
        throw new HttpsError('internal', 'Eşleşme sırasında bir hata oluştu.');
    }
});
