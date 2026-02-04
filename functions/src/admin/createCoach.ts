import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth } from "../firebase";

export const createCoach = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin veya Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }


    const data = request.data;

    try {
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
        });

        await auth.setCustomUserClaims(userRecord.uid, {
            coach: true,
            role: 'coach'
        });

        await db.collection('users').doc(userRecord.uid).set({
            uid: userRecord.uid,
            role: 'coach',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            expertise: data.expertise,
            experienceYears: data.experienceYears,
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now()
        });

        return { success: true, message: "Hoca başarıyla oluşturuldu." };

    } catch (error: any) {
        throw new HttpsError('internal', error.message);
    }
});
