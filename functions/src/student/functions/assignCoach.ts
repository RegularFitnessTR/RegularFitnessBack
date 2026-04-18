import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { StudentUser } from "../types/student.model";

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
        // 0. Fetch student document to check gymId
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci kaydı bulunamadı.');
        }
        const studentData = studentDoc.data() as StudentUser;

        if (!studentData.gymId) {
            throw new HttpsError('failed-precondition', 'Henüz bir spor salonuna kayıtlı değilsiniz. Lütfen önce bir spor salonuna kaydolun.');
        }

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

        // Hoca bir salona bağlı olmalı
        if (!coachData.gymId) {
            throw new HttpsError(
                'failed-precondition',
                'Bu hoca henüz herhangi bir salona bağlı değil. Lütfen başka bir hoca seçin.'
            );
        }

        // Hoca ile öğrenci aynı salonda olmalı
        if (coachData.gymId !== studentData.gymId) {
            throw new HttpsError(
                'failed-precondition',
                'Bu hoca sizin kayıtlı olduğunuz salona ait değil. Lütfen kendi salonunuzdan bir hoca seçin.'
            );
        }

        const batch = db.batch();

        batch.update(db.collection(COLLECTIONS.STUDENTS).doc(studentId), {
            coachId: coachId,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Aktif abonelik varsa coachId'yi güncelle
        if (studentData.activeSubscriptionId) {
            batch.update(
                db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(studentData.activeSubscriptionId),
                {
                    coachId: coachId,
                    updatedAt: admin.firestore.Timestamp.now()
                }
            );
        }

        await batch.commit();

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

        void logError({
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
