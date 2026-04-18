import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../../common";
import { MembershipSubscription } from "../../../subscription/types/subscription.model";
import { SubscriptionStatus } from "../../../subscription/types/subscription.enums";
import { PaymentMethodType } from "../../../gym/types/gym.enums";
import { SystemEvent } from "../../../notification/types/system-event.model";
import { logError } from "../../../log/utils/logError";
import { LogSeverity } from "../../../log/types/log.enums";
import { sendNotification } from "../../../notification/utils/sendNotification";

// Her gün gece yarısı çalışır
export const checkCommitmentExpiry = onSchedule('0 0 * * *', async () => {
    const now = admin.firestore.Timestamp.now();

    try {
        // Taahhüdü hâlâ aktif görünen ama süresi dolmuş üyelikleri bul
        const expiredCommitmentsQuery = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
            .where('type', '==', PaymentMethodType.MEMBERSHIP)
            .where('status', '==', SubscriptionStatus.ACTIVE)
            .where('isCommitmentActive', '==', true)
            .where('commitmentEndsAt', '<=', now)
            .get();

        if (expiredCommitmentsQuery.empty) return;

        const batch = db.batch();

        for (const doc of expiredCommitmentsQuery.docs) {
            const sub = doc.data() as MembershipSubscription;

            // Taahhüdü kapat, baz fiyata geç
            batch.update(doc.ref, {
                isCommitmentActive: false,
                monthlyPrice: sub.baseMonthlyPrice,   // baz fiyata dön
                updatedAt: now
            });

            // Sistem eventi yaz
            const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
            const event: SystemEvent = {
                id: eventRef.id,
                type: 'commitment_expired',
                gymId: sub.gymId,
                targetUserId: sub.studentId,
                relatedEntityId: doc.id,
                payload: {
                    previousMonthlyPrice: sub.monthlyPrice,
                    newMonthlyPrice: sub.baseMonthlyPrice,
                    commitmentEndsAt: sub.commitmentEndsAt
                },
                createdAt: now,
                notified: false
            };
            batch.set(eventRef, event);
        }

        await batch.commit();
        console.log(`${expiredCommitmentsQuery.size} taahhüt sona erdi, baz fiyata geçildi.`);

    } catch (error) {
        console.error('checkCommitmentExpiry hatası:', error);

        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';

        void logError({
            functionName: 'checkCommitmentExpiry',
            error,
            severity: LogSeverity.CRITICAL,
        });

        // Superadmin bildirim akışı hata verirse de ayrıca logla.
        try {
            const superadminSnap = await db.collection(COLLECTIONS.SUPERADMINS).get();
            if (!superadminSnap.empty) {
                const superadminIds = superadminSnap.docs.map(d => d.id);
                await sendNotification({
                    recipients: [{ ids: superadminIds, role: 'superadmin' }],
                    notification: {
                        title: 'Cron Job Hatası: checkCommitmentExpiry',
                        body: `Taahhüt süresi kontrolü başarısız oldu. Hata: ${errorMessage}`,
                    },
                    data: { type: 'cron_error', functionName: 'checkCommitmentExpiry' },
                });
            }
        } catch (notificationFlowError) {
            void logError({
                functionName: 'checkCommitmentExpiry.notificationFlow',
                error: notificationFlowError,
                severity: LogSeverity.ERROR,
                requestData: { originalErrorMessage: errorMessage },
            });
        }
    }
});