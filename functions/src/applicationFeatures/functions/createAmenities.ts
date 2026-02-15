import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { CreateFeatureData, FeatureItem } from "../types/features.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

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

        // Log kaydı
        await logActivity({
            action: LogAction.CREATE_AMENITIES,
            category: LogCategory.APPLICATION_FEATURES,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: id,
                type: 'amenity',
                name: data.name
            }
        });

        return {
            success: true,
            message: "İmkan başarıyla eklendi.",
            data: newItem
        };

    } catch (error: any) {
        console.error("İmkan oluşturma hatası:", error);

        await logError({
            functionName: 'createAmenities',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });


        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
