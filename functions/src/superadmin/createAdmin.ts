import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth } from "../firebase";
import { AppUser, RegisterAdminData } from "../types";

export const createAdmin = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    // Token içindeki custom claim'i kontrol et
    if (request.auth.token.role !== 'superadmin' && !request.auth.token.superadmin) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok (Sadece Superadmin).');
    }

    const data = request.data as RegisterAdminData;

    if (!data.email || !data.password || !data.firstName || !data.lastName) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Email, şifre, ad ve soyad zorunludur.'
        );
    }

    try {
        // 2. Auth Kullanıcısı Oluştur
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        // 3. Custom Claim ekle (Admin yetkisi veriyoruz)
        await auth.setCustomUserClaims(userRecord.uid, {
            admin: true,
            role: 'admin'
        });

        // 4. Firestore Kaydı
        const newAdmin: AppUser = {
            uid: userRecord.uid,
            role: 'admin',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber || "",
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now()
        };

        await db.collection('users').doc(userRecord.uid).set(newAdmin);

        return {
            success: true,
            message: "Admin başarıyla oluşturuldu.",
            uid: userRecord.uid
        };

    } catch (error: any) {
        console.error("Admin oluşturma hatası:", error);

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
