import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";

/**
 * Tüm PACKAGE aboneliklerinin `scheduledSessionsCount` field'ını gerçek
 * appointments durumuna göre yeniden hesaplar (pending + completed + postponed).
 *
 * - Sadece superadmin çalıştırabilir.
 * - Idempotent: birden fazla kez çağrılabilir.
 * - createAppointments tarafında zaten "yoksa migrate et" path'i var, ama bu
 *   endpoint hepsini bir kerede backfill edip eski subscription'ları hızlandırır.
 */
export const migrateSubscriptionCounters = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }
    if (request.auth.token.role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için superadmin yetkisi gereklidir.');
    }

    const subsSnap = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
        .where('type', '==', PaymentMethodType.PACKAGE)
        .get();

    const now = admin.firestore.Timestamp.now();
    const CHUNK = 25;
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { id: string; reason: string }[] = [];

    for (let i = 0; i < subsSnap.docs.length; i += CHUNK) {
        const slice = subsSnap.docs.slice(i, i + CHUNK);

        await Promise.all(slice.map(async (subDoc) => {
            try {
                const countSnap = await db.collection(COLLECTIONS.APPOINTMENTS)
                    .where('subscriptionId', '==', subDoc.id)
                    .where('status', 'in', ['pending', 'completed', 'postponed'])
                    .count()
                    .get();
                const real = countSnap.data().count;
                const current = subDoc.data().scheduledSessionsCount;

                if (typeof current === 'number' && current === real) {
                    skipped++;
                    return;
                }

                await subDoc.ref.update({
                    scheduledSessionsCount: real,
                    updatedAt: now,
                });
                updated++;
            } catch (err: any) {
                errors.push({ id: subDoc.id, reason: err?.message || 'unknown' });
            } finally {
                processed++;
            }
        }));
    }

    return {
        success: true,
        message: `Migration tamamlandı: ${processed} abonelik tarandı, ${updated} güncellendi, ${skipped} zaten doğruydu, ${errors.length} hata.`,
        processed,
        updated,
        skipped,
        errors,
    };
});
