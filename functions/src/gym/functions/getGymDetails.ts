import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";

function canAccessGymByRole(request: any, gymId: string): boolean {
    const role = request.auth?.token?.role;

    if (role === 'superadmin') {
        return true;
    }

    if (role === 'admin') {
        const adminGymIds: string[] = request.auth?.token?.gymIds || [];
        return adminGymIds.includes(gymId);
    }

    if (role === 'coach' || role === 'student') {
        const ownGymId: string = request.auth?.token?.gymId || '';
        return ownGymId === gymId;
    }

    return false;
}

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
        if (!canAccessGymByRole(request, gymId)) {
            throw new HttpsError('permission-denied', 'Bu spor salonuna erişim yetkiniz yok.');
        }

        // 2. Get gym document
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = serializeTimestamps(gymDoc.data());

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
