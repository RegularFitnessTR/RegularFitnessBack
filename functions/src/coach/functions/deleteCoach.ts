import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth, COLLECTIONS } from "../../common";

export const deleteCoach = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin veya Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const { coachUid } = request.data;

    if (!coachUid) {
        throw new HttpsError(
            'invalid-argument',
            'Coach UID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Query from coaches collection
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachUid).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }

        const coachData = coachDoc.data();

        // Verify it's actually a coach
        if (coachData?.role !== 'coach') {
            throw new HttpsError(
                'permission-denied',
                'Bu kullanıcı bir hoca değil, dolayısıyla silinemez.'
            );
        }

        // 3. Delete from Firebase Auth
        await auth.deleteUser(coachUid);

        // 4. Delete from coaches collection
        await db.collection(COLLECTIONS.COACHES).doc(coachUid).delete();

        return {
            success: true,
            message: "Hoca başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Hoca silme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        if (error.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
