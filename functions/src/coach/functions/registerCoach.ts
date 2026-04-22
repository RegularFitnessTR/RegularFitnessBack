import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { generateQRCode } from "../../common/utils/qrcode";
import { CoachUser } from "../types/coach.model";
import { RegisterCoachData } from "../types/coach.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const registerCoach = onCall(async (request) => {
    const data = request.data as RegisterCoachData;

    if (
        !data.email ||
        !data.password ||
        !data.firstName ||
        !data.lastName ||
        !data.expertise ||
        data.experienceYears === undefined
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Eksik bilgi: Email, şifre, ad, soyad, uzmanlık alanı ve deneyim yılı zorunludur."
        );
    }

    // İsteğe bağlı salon kaydı — kayıt sırasında publicId verilirse doğrulanır
    let resolvedGymId = "";
    let resolvedGymName = "";
    if (data.gymPublicId) {
        const gymSnapshot = await db
            .collection(COLLECTIONS.GYMS)
            .where("publicId", "==", data.gymPublicId)
            .limit(1)
            .get();

        if (gymSnapshot.empty) {
            throw new HttpsError(
                "not-found",
                "Belirtilen salon kodu bulunamadı. Lütfen kodu kontrol ediniz."
            );
        }

        resolvedGymId = gymSnapshot.docs[0].id;
        resolvedGymName = gymSnapshot.docs[0].data()?.name || "";
    }

    try {
        // 1. Firebase Auth kullanıcısı oluştur
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        // 2. Coach rolü için custom claim ata (gymId dahil)
        await auth.setCustomUserClaims(userRecord.uid, {
            role: "coach",
            coach: true,
            gymId: resolvedGymId,
        });

        // 3. Hocaya özgü QR kodu üret — çakışma olmadığından emin ol
        let qrCodeString = generateQRCode();
        let qrExists = await db.collection(COLLECTIONS.COACHES)
            .where('qrCodeString', '==', qrCodeString).limit(1).get();
        while (!qrExists.empty) {
            qrCodeString = generateQRCode();
            qrExists = await db.collection(COLLECTIONS.COACHES)
                .where('qrCodeString', '==', qrCodeString).limit(1).get();
        }

        // 4. Firestore'da coaches koleksiyonuna kaydet
        const newCoach: CoachUser = {
            uid: userRecord.uid,
            role: "coach",
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber || "",
            expertise: data.expertise,
            experienceYears: data.experienceYears,
            qrCodeString,
            photoUrl: "",
            gymId: resolvedGymId,
            createdAt: admin.firestore.Timestamp.now(),
        };

        await db.collection(COLLECTIONS.COACHES).doc(userRecord.uid).set(newCoach);

        void logActivity({
            action: LogAction.REGISTER_COACH,
            category: LogCategory.COACH,
            performedBy: {
                uid: userRecord.uid,
                role: "coach",
                name: `${data.firstName} ${data.lastName}`,
            },
            targetEntity: resolvedGymId
                ? { id: resolvedGymId, type: "gym", name: resolvedGymName }
                : { id: userRecord.uid, type: "coach", name: `${data.firstName} ${data.lastName}` },
            gymId: resolvedGymId || undefined,
            details: { email: data.email, expertise: data.expertise },
        });

        return {
            success: true,
            message: "Kayıt başarıyla tamamlandı.",
            uid: userRecord.uid,
            qrCodeString,
        };

    } catch (error: any) {
        void logError({
            functionName: "registerCoach",
            error,
            requestData: data,
        });

        if (error.code === "auth/email-already-exists") {
            throw new HttpsError("already-exists", "Bu email adresi zaten kullanımda.");
        }

        throw new HttpsError("internal", "Kayıt işlemi sırasında bir hata oluştu.");
    }
});
