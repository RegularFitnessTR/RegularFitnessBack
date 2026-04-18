import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError, syncGymClaims } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const joinGym = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const studentId = request.auth.uid;
    const { gymPublicId } = request.data as { gymPublicId: string };

    if (!gymPublicId) {
        throw new HttpsError('invalid-argument', 'Salon kodu bilgisi eksik.');
    }

    try {
        // 1. Öğrenci kontrolü
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bilgisi bulunamadı.');
        }

        const studentData = studentDoc.data();
        if (studentData?.gymId) {
            throw new HttpsError(
                'already-exists',
                'Zaten bir salona kayıtlısınız. Önce mevcut salondan ayrılmanız gerekmektedir.'
            );
        }

        // 2. Gym'i publicId ile bul
        const gymSnapshot = await db.collection(COLLECTIONS.GYMS)
            .where('publicId', '==', gymPublicId)
            .limit(1)
            .get();

        if (gymSnapshot.empty) {
            throw new HttpsError(
                'not-found',
                'Belirtilen salon kodu bulunamadı. Lütfen kodu kontrol ediniz.'
            );
        }

        const gymDoc = gymSnapshot.docs[0];
        const gymData = gymDoc.data();

        // 3. Öğrenciyi gym'e kaydet
        await db.collection(COLLECTIONS.STUDENTS).doc(studentId).update({
            gymId: gymDoc.id,
            updatedAt: admin.firestore.Timestamp.now()
        });

        await syncGymClaims(studentId, { gymId: gymDoc.id });

        // Log kaydı
        void logActivity({
            action: LogAction.JOIN_GYM,
            category: LogCategory.STUDENT,
            performedBy: {
                uid: studentId,
                role: 'student',
                name: request.auth!.token.name || 'Student'
            },
            targetEntity: {
                id: gymDoc.id,
                type: 'gym',
                name: gymData.name
            },
            gymId: gymDoc.id
        });

        return {
            success: true,
            message: "Salona başarıyla kayıt oldunuz.",
            gymName: gymData.name
        };

    } catch (error: any) {
        console.error("Salon kayıt hatası:", error);

        void logError({
            functionName: 'joinGym',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { gymPublicId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Salon kaydı sırasında bir hata oluştu.');
    }
});
