import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { logError } from "../../log/utils/logError";

async function canAccessGymByRole(request: any, gymId: string): Promise<boolean> {
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
        if (ownGymId === gymId) {
            return true;
        }

        const collection = role === 'coach' ? COLLECTIONS.COACHES : COLLECTIONS.STUDENTS;
        const userDoc = await db.collection(collection).doc(request.auth.uid).get();
        if (!userDoc.exists) {
            return false;
        }

        const profileGymId = userDoc.data()?.gymId;
        return typeof profileGymId === 'string' && profileGymId === gymId;
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
        // Speculative paralel: erişim kontrolü ile gym fetch'i aynı anda başlat.
        // Permission-denied case'i nadirdir; küçük bir wasted-read kabul edilebilir trade-off.
        const [accessAllowed, gymDoc] = await Promise.all([
            canAccessGymByRole(request, gymId),
            db.collection(COLLECTIONS.GYMS).doc(gymId).get(),
        ]);

        if (!accessAllowed) {
            throw new HttpsError('permission-denied', 'Bu spor salonuna erişim yetkiniz yok.');
        }

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

        void logError({
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
