import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { Gym } from "../../gym/types/gym.model";
import { GymPresenceRecord } from "../types/gymPresence.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface GymCheckOutData {
    gymPublicId: string;
}

export const gymCheckOut = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role, uid } = request.auth.token;

    if (role !== 'student' && role !== 'coach') {
        throw new HttpsError('permission-denied', 'Sadece öğrenci ve hocalar salon çıkışı yapabilir.');
    }

    const data = request.data as GymCheckOutData;
    if (!data.gymPublicId) {
        throw new HttpsError('invalid-argument', 'Salon QR kodu zorunludur.');
    }

    try {
        // Salonu publicId üzerinden bul
        const gymSnapshot = await db.collection(COLLECTIONS.GYMS)
            .where('publicId', '==', data.gymPublicId)
            .limit(1)
            .get();

        if (gymSnapshot.empty) {
            throw new HttpsError('not-found', 'Salon bulunamadı.');
        }

        const gymDoc = gymSnapshot.docs[0];
        const gym = gymDoc.data() as Gym;
        const gymId = gymDoc.id;

        // Aktif giriş kaydını bul
        const presenceSnapshot = await db.collection(COLLECTIONS.GYM_PRESENCE)
            .where('gymId', '==', gymId)
            .where('userId', '==', uid)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (presenceSnapshot.empty) {
            throw new HttpsError('not-found', 'Bu salona aktif giriş kaydınız bulunmuyor.');
        }

        const presenceDoc = presenceSnapshot.docs[0];
        const presence = presenceDoc.data() as GymPresenceRecord;
        const now = admin.firestore.Timestamp.now();

        await presenceDoc.ref.update({
            isActive: false,
            checkedOutAt: now,
        });

        await logActivity({
            action: LogAction.GYM_CHECK_OUT,
            category: LogCategory.GYM_PRESENCE,
            performedBy: {
                uid,
                role: role as UserRole,
                name: `${presence.firstName} ${presence.lastName}`
            },
            targetEntity: {
                id: gymId,
                type: 'gym',
                name: gym.name
            },
            gymId,
            details: { gymPublicId: data.gymPublicId, presenceId: presenceDoc.id }
        });

        return { success: true, message: 'Salon çıkışı başarılı.' };

    } catch (error: any) {
        await logError({
            functionName: 'gymCheckOut',
            error,
            userId: uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Salon çıkışı sırasında bir hata oluştu.');
    }
});
