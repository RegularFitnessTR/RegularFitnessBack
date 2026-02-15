import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { CreateFeatureData, FeatureItem } from "../types/features.dto";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const createGymTypes = onCall(async (request) => {
    // 1. Auth Check - Admin/Superadmin only
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as CreateFeatureData;

    // 2. Validate
    if (!data.name) {
        throw new HttpsError('invalid-argument', 'Tip adı zorunludur.');
    }

    try {
        // 3. Add to Gym Types list
        // We'll store these in a single document 'gym_types' inside 'applicationFeatures' collection
        // Or separate documents if we expect many types. For simple lists, arrayUnion in a single doc is often cheaper/easier, 
        // but creates a limit of 1MB per doc. 
        // Given the requirement "veritabanına eklemesini istiyorum", let's use a subcollection or separate docs for scalability 
        // OR a single doc with an array if strictly controlled.
        // Let's use a single document `applicationFeatures/gym_types` with an array `items`.

        const featuresRef = db.collection(COLLECTIONS.APPLICATION_FEATURES || 'applicationFeatures').doc('gym_types');

        // Use a slug or UUID for ID. Simple slug is readable.
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
            action: LogAction.CREATE_GYM_TYPES,
            category: LogCategory.APPLICATION_FEATURES,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: id,
                type: 'gymType',
                name: data.name
            }
        });

        return {
            success: true,
            message: "Gym tipi başarıyla eklendi.",
            data: newItem
        };

    } catch (error: any) {
        console.error("Gym tipi oluşturma hatası:", error);
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
