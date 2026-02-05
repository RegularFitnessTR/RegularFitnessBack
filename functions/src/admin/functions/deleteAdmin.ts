import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth, COLLECTIONS } from "../../common";

export const deleteAdmin = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // Token içindeki custom claim'i kontrol et
    if (request.auth.token.role !== 'superadmin' && !request.auth.token.superadmin) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok (Sadece Superadmin).');
    }

    const { adminUid } = request.data;

    if (!adminUid) {
        throw new HttpsError(
            'invalid-argument',
            'Admin UID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Query from admins collection
        const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(adminUid).get();

        if (!adminDoc.exists) {
            throw new HttpsError('not-found', 'Admin kullan bulunamadı.');
        }

        const adminData = adminDoc.data();

        // Verify it's actually an admin
        if (adminData?.role !== 'admin') {
            throw new HttpsError(
                'permission-denied',
                'Bu kullanıcı bir admin değil, dolayısıyla silinemez.'
            );
        }

        // 3. Delete from Firebase Auth
        await auth.deleteUser(adminUid);

        // 4. Delete from admins collection
        await db.collection(COLLECTIONS.ADMINS).doc(adminUid).delete();

        return {
            success: true,
            message: "Admin başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Admin silme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        if (error.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'Admin kullanıcısı bulunamadı.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
