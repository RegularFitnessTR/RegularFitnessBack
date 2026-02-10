import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { CreateFeatureData, FeatureItem } from "../types/features.dto";

export const createAmenities = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as CreateFeatureData;

    if (!data.name) {
        throw new HttpsError('invalid-argument', 'İmkan adı zorunludur.');
    }

    try {
        const featuresRef = db.collection(COLLECTIONS.APPLICATION_FEATURES).doc('amenities');

        const id = data.name.toLowerCase().replace(/\s+/g, '_');

        const newItem: FeatureItem = {
            id: id,
            name: data.name,
            createdAt: admin.firestore.Timestamp.now()
        };

        await featuresRef.set({
            items: admin.firestore.FieldValue.arrayUnion(newItem),
            updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });

        return {
            success: true,
            message: "İmkan başarıyla eklendi.",
            data: newItem
        };

    } catch (error: any) {
        console.error("İmkan oluşturma hatası:", error);
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
