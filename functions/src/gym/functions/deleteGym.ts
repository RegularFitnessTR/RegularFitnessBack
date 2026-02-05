import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";

export const deleteGym = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const { gymId } = request.data;

    if (!gymId) {
        throw new HttpsError(
            'invalid-argument',
            'Gym ID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Verify gym exists and admin owns it
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();

        // Verify ownership (either owner or superadmin)
        if (gymData?.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError(
                'permission-denied',
                'Bu spor salonunu silme yetkiniz yok.'
            );
        }

        // 3. Remove gymId from all coaches in this gym
        const coachesSnapshot = await db.collection(COLLECTIONS.COACHES)
            .where('gymId', '==', gymId)
            .get();

        const batch = db.batch();

        coachesSnapshot.forEach(doc => {
            batch.update(doc.ref, {
                gymId: admin.firestore.FieldValue.delete(),
                updatedAt: admin.firestore.Timestamp.now()
            });
        });

        // 4. Delete gym document
        batch.delete(db.collection(COLLECTIONS.GYMS).doc(gymId));

        // 5. Remove gymId from admin's gymIds array
        batch.update(db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid), {
            gymIds: admin.firestore.FieldValue.arrayRemove(gymId),
            updatedAt: admin.firestore.Timestamp.now()
        });

        await batch.commit();

        return {
            success: true,
            message: "Spor salonu başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Gym silme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
