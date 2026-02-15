import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { DeleteFeatureData, FeatureItem } from "../types/features.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const deleteAmenities = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as DeleteFeatureData;

    if (!data.id) {
        throw new HttpsError('invalid-argument', 'İmkan ID\'si zorunludur.');
    }

    try {
        const featuresRef = db.collection(COLLECTIONS.APPLICATION_FEATURES).doc('amenities');

        const doc = await featuresRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'İmkanlar bulunamadı.');
        }

        const items = doc.data()?.items as FeatureItem[] || [];
        const itemToRemove = items.find(item => item.id === data.id);

        if (!itemToRemove) {
            throw new HttpsError('not-found', 'Silinecek imkan bulunamadı.');
        }

        await featuresRef.update({
            items: admin.firestore.FieldValue.arrayRemove(itemToRemove),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        await logActivity({
            action: LogAction.DELETE_AMENITIES,
            category: LogCategory.APPLICATION_FEATURES,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.id,
                type: 'amenity',
                name: itemToRemove.name
            }
        });

        return {
            success: true,
            message: "İmkan başarıyla silindi."
        };

    } catch (error: any) {
        console.error("İmkan silme hatası:", error);

        await logError({
            functionName: 'deleteAmenities',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
