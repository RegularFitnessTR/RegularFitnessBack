import { db, auth, COLLECTIONS, syncGymClaims, onCall, HttpsError } from "../../common";
import { UpdateCoachData } from "../types/coach.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const updateCoach = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin veya Superadmin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as UpdateCoachData;

    if (!data.coachUid) {
        throw new HttpsError(
            'invalid-argument',
            'Coach UID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Query from coaches collection
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(data.coachUid).get();

        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }

        const coachData = coachDoc.data();

        // Verify it's actually a coach
        if (coachData?.role !== 'coach') {
            throw new HttpsError(
                'permission-denied',
                'Bu kullanıcı bir hoca değil, dolayısıyla güncellenemez.'
            );
        }

        // 3. Firebase Auth güncellemeleri
        const authUpdates: any = {};

        if (data.email) {
            authUpdates.email = data.email;
        }

        if (data.firstName || data.lastName) {
            const firstName = data.firstName || coachData.firstName;
            const lastName = data.lastName || coachData.lastName;
            authUpdates.displayName = `${firstName} ${lastName}`;
        }

        if (data.phoneNumber !== undefined) {
            authUpdates.phoneNumber = data.phoneNumber || null;
        }

        // Auth güncellemesi varsa uygula
        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(data.coachUid, authUpdates);
        }

        // 4. Firestore güncellemeleri in coaches collection
        const firestoreUpdates: any = {};

        if (data.firstName) {
            firestoreUpdates.firstName = data.firstName;
        }

        if (data.lastName) {
            firestoreUpdates.lastName = data.lastName;
        }

        if (data.phoneNumber !== undefined) {
            firestoreUpdates.phoneNumber = data.phoneNumber;
        }

        if (data.email) {
            firestoreUpdates.email = data.email;
        }

        if (data.expertise !== undefined) {
            firestoreUpdates.expertise = data.expertise;
        }

        if (data.experienceYears !== undefined) {
            firestoreUpdates.experienceYears = data.experienceYears;
        }

        if (data.gymId !== undefined) {
            firestoreUpdates.gymId = data.gymId || null;
        }

        // Firestore güncellemesi varsa uygula
        if (Object.keys(firestoreUpdates).length > 0) {
            await db.collection(COLLECTIONS.COACHES).doc(data.coachUid).update(firestoreUpdates);
        }

        // gymId değiştiyse custom claims'i de güncelle
        if (data.gymId !== undefined) {
            await syncGymClaims(data.coachUid, { gymId: data.gymId || '' });
        }

        // Log kaydı
        await logActivity({
            action: LogAction.UPDATE_COACH,
            category: LogCategory.COACH,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.coachUid,
                type: 'coach',
                name: `${coachData?.firstName} ${coachData?.lastName}`
            },
            gymId: coachData?.gymId,
            details: { updatedFields: Object.keys(firestoreUpdates) }
        });

        return {
            success: true,
            message: "Hoca başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Hoca güncelleme hatası:", error);

        await logError({
            functionName: 'updateCoach',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        if (error.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
