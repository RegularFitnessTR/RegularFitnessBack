import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { defineString } from "firebase-functions/params";
import { db, auth, COLLECTIONS } from "../../common";
import { SuperAdminUser } from "../types/superadmin.model";
import { RegisterSuperAdminData } from "../types/superadmin.dto";

// Define configuration parameter for Master Key
const masterKeyParam = defineString("SUPERADMIN_MASTER_KEY", {
    default: "CHANGE_ME_NOW",
    description: "Master key required to register a superadmin"
});

export const registerSuperAdmin = onCall(async (request) => {
    const data = request.data as RegisterSuperAdminData;

    // 1. Master Key Kontrolü
    const configuredMasterKey = masterKeyParam.value();
    if (data.masterKey !== configuredMasterKey) {
        throw new HttpsError(
            'permission-denied',
            'Geçersiz Master Key. Bu işlem yetkisiz.'
        );
    }

    if (!data.email || !data.password || !data.firstName || !data.lastName) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Email, şifre, ad ve soyad zorunludur.'
        );
    }

    try {
        // 2. Create Firebase Auth user
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        // 3. Set custom claims for superadmin role
        await auth.setCustomUserClaims(userRecord.uid, {
            role: 'superadmin',
            superadmin: true
        });

        // 4. Create Firestore document in superadmins collection
        const newSuperAdmin: SuperAdminUser = {
            uid: userRecord.uid,
            role: 'superadmin',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber || "",
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now()
        };

        await db.collection(COLLECTIONS.SUPERADMINS).doc(userRecord.uid).set(newSuperAdmin);

        return {
            success: true,
            message: "Superadmin başarıyla oluşturuldu.",
            uid: userRecord.uid
        };

    } catch (error: any) {
        console.error("Superadmin kayıt hatası:", error);

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'Kayıt işlemi sırasında bir hata oluştu.');
    }
});
