import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { DeleteFeatureData, FeatureItem } from "../types/features.dto";

export const deleteSocialMediaTypes = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as DeleteFeatureData;

    if (!data.id) {
        throw new HttpsError('invalid-argument', 'Platform ID\'si zorunludur.');
    }

    try {
        const featuresRef = db.collection(COLLECTIONS.APPLICATION_FEATURES).doc('social_media_types');

        const doc = await featuresRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'Sosyal medya platformları bulunamadı.');
        }

        const items = doc.data()?.items as FeatureItem[] || [];
        const itemToRemove = items.find(item => item.id === data.id);

        if (!itemToRemove) {
            throw new HttpsError('not-found', 'Silinecek platform bulunamadı.');
        }

        await featuresRef.update({
            items: admin.firestore.FieldValue.arrayRemove(itemToRemove),
            updatedAt: admin.firestore.Timestamp.now()
        });

        return {
            success: true,
            message: "Sosyal medya platformu başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Sosyal medya silme hatası:", error);
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
