import * as admin from "firebase-admin";
import { defineString } from "firebase-functions/params";
import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { AdminUser } from "../types/admin.model";
import { RegisterAdminSelfData } from "../types/admin.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

const adminRegisterMasterKeyParam = defineString("ADMIN_REGISTER_MASTER_KEY", {
    default: "CHANGE_ME_NOW",
    description: "Master key required to register an admin"
});

export const registerAdmin = onCall(async (request) => {
    const data = request.data as RegisterAdminSelfData;

    const configuredMasterKey = adminRegisterMasterKeyParam.value();
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

    const gymIdsInput = data.gymIds ?? [];
    if (!Array.isArray(gymIdsInput) || gymIdsInput.some((id) => typeof id !== 'string')) {
        throw new HttpsError('invalid-argument', 'gymIds string[] formatında olmalıdır.');
    }

    const gymIds = [...new Set(gymIdsInput.map((id) => id.trim()).filter((id) => id.length > 0))];

    if (gymIds.length > 0) {
        const gymRefs = gymIds.map((gymId) => db.collection(COLLECTIONS.GYMS).doc(gymId));
        const gymDocs = await db.getAll(...gymRefs);
        const missingGymIds = gymDocs.filter((doc) => !doc.exists).map((doc) => doc.id);

        if (missingGymIds.length > 0) {
            throw new HttpsError(
                'invalid-argument',
                `Bazı gymId değerleri bulunamadı: ${missingGymIds.join(', ')}`
            );
        }
    }

    try {
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        await auth.setCustomUserClaims(userRecord.uid, {
            role: 'admin',
            admin: true,
            gymIds
        });

        const newAdmin: AdminUser = {
            uid: userRecord.uid,
            role: 'admin',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber || "",
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now(),
            gymIds
        };

        await db.collection(COLLECTIONS.ADMINS).doc(userRecord.uid).set(newAdmin);

        void logActivity({
            action: LogAction.CREATE_ADMIN,
            category: LogCategory.ADMIN,
            performedBy: {
                uid: userRecord.uid,
                role: 'admin',
                name: `${data.firstName} ${data.lastName}`
            },
            targetEntity: {
                id: userRecord.uid,
                type: 'admin',
                name: `${data.firstName} ${data.lastName}`
            },
            details: { source: 'self-register', gymIds }
        });

        return {
            success: true,
            message: "Admin başarıyla oluşturuldu.",
            uid: userRecord.uid
        };

    } catch (error: any) {
        void logError({
            functionName: 'registerAdmin',
            error,
            requestData: {
                email: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
                phoneNumber: data.phoneNumber,
                gymIds
            }
        });

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Kayıt işlemi sırasında bir hata oluştu.');
    }
});