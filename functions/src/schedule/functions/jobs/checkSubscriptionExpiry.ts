import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../../common";
import { MembershipSubscription } from "../../../subscription/types/subscription.model";
import { SubscriptionStatus } from "../../../subscription/types/subscription.enums";
import { PaymentMethodType } from "../../../gym/types/gym.enums";
import { SystemEvent } from "../../../notification/types/system-event.model";
import { ensureMonthlyPaymentsUpToMonth, getElapsedMonthNumber } from "../../../subscription/utils/membershipPayments";
import { logError } from "../../../log/utils/logError";
import { LogSeverity } from "../../../log/types/log.enums";
import { sendNotification } from "../../../notification/utils/sendNotification";

// Her gün sabah 06:00'da çalışır
export const checkSubscriptionExpiry = onSchedule('0 6 * * *', async () => {
    const now = admin.firestore.Timestamp.now();

    // 3 gün sonrasını hesapla (yaklaşan ödeme uyarısı için)
    const threeDaysLater = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + 3 * 24 * 60 * 60 * 1000
    );

    try {
        // Aktif üyelik aboneliklerini çek
        const activeSubsQuery = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
            .where('type', '==', PaymentMethodType.MEMBERSHIP)
            .where('status', '==', SubscriptionStatus.ACTIVE)
            .get();

        if (activeSubsQuery.empty) return;

        const batch = db.batch();
        let updateCount = 0;
        let eventCount = 0;

        for (const doc of activeSubsQuery.docs) {
            const sub = doc.data() as MembershipSubscription;
            const elapsedMonth = getElapsedMonthNumber(sub.startDate, now);
            const normalizedPayments = ensureMonthlyPaymentsUpToMonth(sub, elapsedMonth + 1);

            if (normalizedPayments.length !== (sub.monthlyPayments || []).length) {
                batch.update(doc.ref, {
                    monthlyPayments: normalizedPayments,
                    updatedAt: now
                });
                updateCount++;
            }

            // Yaklaşan ödeme kontrolü
            const upcomingPayment = normalizedPayments.find(
                (p: any) =>
                    p.status === 'pending' &&
                    p.dueDate?.toMillis &&
                    p.dueDate.toMillis() <= threeDaysLater.toMillis() &&
                    p.dueDate.toMillis() >= now.toMillis()
            );

            if (upcomingPayment) {
                const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
                const event: SystemEvent = {
                    id: eventRef.id,
                    type: 'payment_due',
                    gymId: sub.gymId,
                    targetUserId: sub.studentId,
                    relatedEntityId: doc.id,
                    payload: {
                        amount: upcomingPayment.amount,
                        dueDate: upcomingPayment.dueDate,
                        month: upcomingPayment.month
                    },
                    createdAt: now,
                    notified: false
                };
                batch.set(eventRef, event);
                eventCount++;
            }

            // Gecikmiş ödeme kontrolü
            const overduePayment = normalizedPayments.find(
                (p: any) =>
                    p.status === 'pending' &&
                    p.dueDate?.toMillis &&
                    p.dueDate.toMillis() < now.toMillis()
            );

            if (overduePayment) {
                const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
                const event: SystemEvent = {
                    id: eventRef.id,
                    type: 'payment_overdue',
                    gymId: sub.gymId,
                    targetUserId: sub.studentId,
                    relatedEntityId: doc.id,
                    payload: {
                        amount: overduePayment.amount,
                        dueDate: overduePayment.dueDate,
                        month: overduePayment.month
                    },
                    createdAt: now,
                    notified: false
                };
                batch.set(eventRef, event);
                eventCount++;
            }
        }

        if (eventCount > 0 || updateCount > 0) {
            await batch.commit();
        }

        console.log(`${eventCount} ödeme eventi yazıldı.`);

    } catch (error) {
        console.error('checkSubscriptionExpiry hatası:', error);

        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';

        void logError({
            functionName: 'checkSubscriptionExpiry',
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
                        title: 'Cron Job Hatası: checkSubscriptionExpiry',
                        body: `Üyelik/ödeme kontrolü başarısız oldu. Hata: ${errorMessage}`,
                    },
                    data: { type: 'cron_error', functionName: 'checkSubscriptionExpiry' },
                });
            }
        } catch (notificationFlowError) {
            void logError({
                functionName: 'checkSubscriptionExpiry.notificationFlow',
                error: notificationFlowError,
                severity: LogSeverity.ERROR,
                requestData: { originalErrorMessage: errorMessage },
            });
        }
    }
});