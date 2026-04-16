import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";

/**
 * Mevcut admin ve coach kullanıcılarının custom claims'lerine
 * gymId/gymIds bilgisini ekler. Sadece superadmin çalıştırabilir.
 * Deploy sonrası bir kez çağrılması yeterlidir.
 */
export const migrateGymClaims = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    if (request.auth.token.role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için superadmin yetkisi gereklidir.');
    }

    let adminCount = 0;
    let coachCount = 0;

    // Admin claims migration
    const adminsSnap = await db.collection(COLLECTIONS.ADMINS).get();
    for (const doc of adminsSnap.docs) {
        const data = doc.data();
        const gymIds: string[] = data.gymIds || [];
        try {
            const user = await auth.getUser(doc.id);
            const currentClaims = user.customClaims || {};
            await auth.setCustomUserClaims(doc.id, { ...currentClaims, gymIds });
            adminCount++;
        } catch {
            console.warn(`Admin claims migration failed for uid: ${doc.id}`);
        }
    }

    // Coach claims migration
    const coachesSnap = await db.collection(COLLECTIONS.COACHES).get();
    for (const doc of coachesSnap.docs) {
        const data = doc.data();
        const gymId: string = data.gymId || '';
        try {
            const user = await auth.getUser(doc.id);
            const currentClaims = user.customClaims || {};
            await auth.setCustomUserClaims(doc.id, { ...currentClaims, gymId });
            coachCount++;
        } catch {
            console.warn(`Coach claims migration failed for uid: ${doc.id}`);
        }
    }

    return {
        success: true,
        message: `Migration tamamlandı: ${adminCount} admin, ${coachCount} coach güncellendi.`
    };
});
