import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const updateCoachProfile = onCall(async (request) => {
    // Coach updates their own profile
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const coachUid = request.auth.uid;
    const data = request.data;

    try {
        // Verify coach exists
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachUid).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca kaydı bulunamadı.');
        }

        const coachData = coachDoc.data();

        // Firebase Auth updates
        const authUpdates: any = {};

        if (data.firstName || data.lastName) {
            const firstName = data.firstName || coachData?.firstName;
            const lastName = data.lastName || coachData?.lastName;
            authUpdates.displayName = `${firstName} ${lastName}`;
        }

        if (data.phoneNumber !== undefined) {
            authUpdates.phoneNumber = data.phoneNumber || null;
        }

        if (data.photoUrl !== undefined) {
            authUpdates.photoURL = data.photoUrl || null;
        }

        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(coachUid, authUpdates);
        }

        // Firestore updates
        const firestoreUpdates: any = {};

        if (data.firstName) firestoreUpdates.firstName = data.firstName;
        if (data.lastName) firestoreUpdates.lastName = data.lastName;
        if (data.photoUrl !== undefined) firestoreUpdates.photoUrl = data.photoUrl;
        if (data.phoneNumber !== undefined) firestoreUpdates.phoneNumber = data.phoneNumber;
        if (data.expertise !== undefined) firestoreUpdates.expertise = data.expertise;
        if (data.experienceYears !== undefined) firestoreUpdates.experienceYears = data.experienceYears;

        if (Object.keys(firestoreUpdates).length > 0) {
            await db.collection(COLLECTIONS.COACHES).doc(coachUid).update(firestoreUpdates);
        }

        // Log kaydı
        void logActivity({
            action: LogAction.UPDATE_COACH_PROFILE,
            category: LogCategory.COACH,
            performedBy: {
                uid: coachUid,
                role: 'coach',
                name: `${coachData?.firstName} ${coachData?.lastName}`
            },
            targetEntity: {
                id: coachUid,
                type: 'coach',
                name: `${coachData?.firstName} ${coachData?.lastName}`
            },
            gymId: coachData?.gymId,
            details: { updatedFields: Object.keys(firestoreUpdates) }
        });

        return {
            success: true,
            message: "Profiliniz başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Profil güncelleme hatası:", error);

        void logError({
            functionName: 'updateCoachProfile',
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
