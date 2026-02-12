import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { AddAmenityData } from "../types/gym.dto";

export const addAmenity = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as AddAmenityData;

    if (!data.gymId || !data.amenities || data.amenities.length === 0) {
        throw new HttpsError('invalid-argument', 'Salon ID ve en az bir imkan bilgisi zorunludur.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);
        const gymDoc = await gymRef.get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Salon bulunamadı.');
        }

        // Check if user is owner or admin
        const gymData = gymDoc.data() as any;
        if (gymData.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu salonu düzenleme yetkiniz yok.');
        }

        await gymRef.update({
            amenities: admin.firestore.FieldValue.arrayUnion(...data.amenities),
            updatedAt: admin.firestore.Timestamp.now()
        });

        return {
            success: true,
            message: "İmkan başarıyla eklendi.",
            data: data.amenities
        };

    } catch (error: any) {
        console.error("İmkan ekleme hatası:", error);
        if (error.code === 'permission-denied' || error.code === 'not-found') {
            throw error;
        }
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});