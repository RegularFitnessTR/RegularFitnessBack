import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logError } from "../../log/utils/logError";
import { GetApplicationFeaturesData } from "../types/features.dto";

const ALLOWED_DOCUMENT_IDS = new Set(['amenities', 'gym_types', 'social_media_types']);

export const getApplicationFeatures = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const data = (request.data ?? {}) as GetApplicationFeaturesData;
    const documentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';

    if (!documentId || !ALLOWED_DOCUMENT_IDS.has(documentId)) {
        throw new HttpsError('invalid-argument', 'Geçersiz documentId.');
    }

    try {
        const featuresDoc = await db.collection(COLLECTIONS.APPLICATION_FEATURES).doc(documentId).get();

        if (!featuresDoc.exists) {
            throw new HttpsError('not-found', 'Uygulama özellikleri bulunamadı.');
        }

        const rawItems = featuresDoc.data()?.items;
        const items = Array.isArray(rawItems)
            ? rawItems
                .map((item) => ({
                    id: typeof item?.id === 'string' ? item.id : '',
                    name: typeof item?.name === 'string' ? item.name : ''
                }))
                .filter((item) => item.id.length > 0 && item.name.length > 0)
            : [];

        return {
            success: true,
            items
        };
    } catch (error: any) {
        await logError({
            functionName: 'getApplicationFeatures',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { documentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Uygulama özellikleri alınırken bir hata oluştu.');
    }
});
