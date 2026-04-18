import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { DeleteFeatureData, FeatureItem } from "../types/features.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { GymType } from "../../gym/types/gym.enums";

export const deleteGymTypes = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as DeleteFeatureData;

    if (!data.id) {
        throw new HttpsError('invalid-argument', 'Tip ID\'si zorunludur.');
    }

    if (data.id === GymType.REFORMER || data.id === GymType.CLASSIC) {
        throw new HttpsError('failed-precondition', 'Standart salon tipleri silinemez.');
    }

    try {
        const featuresRef = db.collection(COLLECTIONS.APPLICATION_FEATURES).doc('gym_types');

        // Use arrayRemove to delete the item from the array
        // However, arrayRemove requires the exact object to be removed. 
        // If we only have the ID, we first need to find the item in the array.

        const doc = await featuresRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'Gym tipleri  bulunamadı.');
        }

        const items = doc.data()?.items as FeatureItem[] || [];
        const itemToRemove = items.find(item => item.id === data.id);

        if (!itemToRemove) {
            throw new HttpsError('not-found', 'Silinecek gym tipi bulunamadı.');
        }

        // Remove using arrayRemove
        await featuresRef.update({
            items: admin.firestore.FieldValue.arrayRemove(itemToRemove),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        void logActivity({
            action: LogAction.DELETE_GYM_TYPES,
            category: LogCategory.APPLICATION_FEATURES,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.id,
                type: 'gymType',
                name: itemToRemove.name
            }
        });

        return {
            success: true,
            message: "Gym tipi başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Gym tipi silme hatası:", error);

        void logError({
            functionName: 'deleteGymTypes',
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
