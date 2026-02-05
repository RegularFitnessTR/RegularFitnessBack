import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS, generateQRCode } from "../../common";
import { CoachUser } from "../types/coach.model";
import { CreateCoachData } from "../types/coach.dto";

export const createCoach = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin veya Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as CreateCoachData;

    // 2. Validate required fields
    if (!data.email || !data.password || !data.firstName || !data.lastName || !data.expertise || data.experienceYears === undefined) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Email, şifre, ad, soyad, uzmanlık alanı ve deneyim yılı zorunludur.'
        );
    }

    try {
        // 3. Create Firebase Auth user
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        // 4. Set custom claims for coach role
        await auth.setCustomUserClaims(userRecord.uid, {
            role: 'coach',
            coach: true
        });

        // 5. Generate unique QR code string for coach
        const qrCodeString = generateQRCode();

        // 6. Create Firestore document in coaches collection
        const newCoach: CoachUser = {
            uid: userRecord.uid,
            role: 'coach',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber || "",
            expertise: data.expertise,
            experienceYears: data.experienceYears,
            qrCodeString: qrCodeString,
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now()
        };

        if (data.gymId) {
            newCoach.gymId = data.gymId;
        }

        await db.collection(COLLECTIONS.COACHES).doc(userRecord.uid).set(newCoach);

        return {
            success: true,
            message: "Hoca başarıyla oluşturuldu.",
            uid: userRecord.uid,
            qrCodeString: qrCodeString
        };

    } catch (error: any) {
        console.error("Hoca oluşturma hatası:", error);

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
