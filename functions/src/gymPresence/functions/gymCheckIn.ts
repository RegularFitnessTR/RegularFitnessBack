import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { Gym } from "../../gym/types/gym.model";
import { BaseUser } from "../../common/types/base";
import { GymPresenceRecord } from "../types/gymPresence.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface GymCheckInData {
    gymPublicId: string;
}

export const gymCheckIn = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role, uid } = request.auth.token;

    if (role !== 'student' && role !== 'coach') {
        throw new HttpsError('permission-denied', 'Sadece öğrenci ve hocalar salona giriş yapabilir.');
    }

    const data = request.data as GymCheckInData;
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

        // Kullanıcının zaten aktif girişi var mı kontrol et
        const existingPresence = await db.collection(COLLECTIONS.GYM_PRESENCE)
            .where('gymId', '==', gymId)
            .where('userId', '==', uid)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (!existingPresence.empty) {
            throw new HttpsError('already-exists', 'Zaten bu salona giriş yaptınız.');
        }

        // Kullanıcı bilgilerini getir
        const collectionName = role === 'student' ? COLLECTIONS.STUDENTS : COLLECTIONS.COACHES;
        const userDoc = await db.collection(collectionName).doc(uid).get();

        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'Kullanıcı bilgileri bulunamadı.');
        }

        const user = userDoc.data() as BaseUser;
        const now = admin.firestore.Timestamp.now();

        const presenceRef = db.collection(COLLECTIONS.GYM_PRESENCE).doc();
        const presenceRecord: GymPresenceRecord = {
            id: presenceRef.id,
            gymId,
            gymPublicId: data.gymPublicId,
            userId: uid,
            userRole: role as 'student' | 'coach',
            firstName: user.firstName,
            lastName: user.lastName,
            checkedInAt: now,
            isActive: true,
            ...(user.photoUrl ? { photoUrl: user.photoUrl } : {}),
        };

        const userRef = db.collection(collectionName).doc(uid);
        const batch = db.batch();
        batch.set(presenceRef, presenceRecord);
        batch.update(userRef, { isInGym: true });
        await batch.commit();

        await logActivity({
            action: LogAction.GYM_CHECK_IN,
            category: LogCategory.GYM_PRESENCE,
            performedBy: {
                uid,
                role: role as UserRole,
                name: `${user.firstName} ${user.lastName}`
            },
            targetEntity: {
                id: gymId,
                type: 'gym',
                name: gym.name
            },
            gymId,
            details: { gymPublicId: data.gymPublicId, presenceId: presenceRef.id }
        });

        return { success: true, message: 'Salona giriş başarılı.', presenceId: presenceRef.id };

    } catch (error: any) {
        await logError({
            functionName: 'gymCheckIn',
            error,
            userId: uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Salon girişi sırasında bir hata oluştu.');
    }
});
