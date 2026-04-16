import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { CreateFeatureData, FeatureItem } from "../types/features.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { GymType } from "../../gym/types/gym.enums";

const ALLOWED_GYM_TYPES: Record<GymType, string> = {
    [GymType.REFORMER]: 'Reformer',
    [GymType.CLASSIC]: 'Classic'
};

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

    const normalizedName = data.name.trim().toLowerCase();
    const mappedType = normalizedName === GymType.REFORMER || normalizedName === 'package'
        ? GymType.REFORMER
        : normalizedName === GymType.CLASSIC || normalizedName === 'membership'
            ? GymType.CLASSIC
            : null;

    if (!mappedType) {
        throw new HttpsError(
            'invalid-argument',
            'Geçersiz salon tipi. Sadece reformer (paket) veya classic (üyelik) tanımlanabilir.'
        );
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
        const id = mappedType;

        const newItem: FeatureItem = {
            id: id,
            name: ALLOWED_GYM_TYPES[mappedType],
            createdAt: admin.firestore.Timestamp.now()
        };

        const existingDoc = await featuresRef.get();
        const existingItems = (existingDoc.data()?.items || []) as FeatureItem[];
        const alreadyExists = existingItems.some((item) => item.id === id);
        if (alreadyExists) {
            throw new HttpsError('already-exists', 'Bu salon tipi zaten mevcut.');
        }

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

        await logError({
            functionName: 'createGymTypes',
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
