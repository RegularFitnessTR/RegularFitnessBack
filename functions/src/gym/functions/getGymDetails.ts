import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logError } from "../../log/utils/logError";

export const getGymDetails = onCall(async (request) => {
    // 1. Verify user is authenticated
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { gymId } = request.data;

    if (!gymId) {
        throw new HttpsError(
            'invalid-argument',
            'Gym ID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Get gym document
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();

        return {
            success: true,
            gym: gymData
        };

    } catch (error: any) {
        console.error("Gym detay hatası:", error);

        await logError({
            functionName: 'getGymDetails',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { gymId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
