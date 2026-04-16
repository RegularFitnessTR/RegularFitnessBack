import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { SubscriptionStatus } from "../types/subscription.enums";
import { MembershipSubscription } from "../types/subscription.model";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { ensureMonthlyPaymentsUpToMonth, getElapsedMonthNumber } from "../utils/membershipPayments";

interface CancelSubscriptionData {
    subscriptionId: string;
    reason?: string;
}

export const cancelSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as CancelSubscriptionData;
    if (!data.subscriptionId) {
        throw new HttpsError('invalid-argument', 'Abonelik ID zorunludur.');
    }

    try {
        const subRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(data.subscriptionId);

        let subType = '';

        await db.runTransaction(async (transaction) => {
            const subDoc = await transaction.get(subRef);
            if (!subDoc.exists) {
                throw new HttpsError('not-found', 'Abonelik bulunamadı.');
            }

            const sub = subDoc.data() as MembershipSubscription | any;

            if (sub.status !== SubscriptionStatus.ACTIVE) {
                throw new HttpsError('failed-precondition', 'Sadece aktif abonelikler iptal edilebilir.');
            }

            // Yetki: coach sadece kendi öğrencisinin aboneliğini iptal edebilir
            if (role === 'coach' && sub.coachId !== request.auth!.uid) {
                throw new HttpsError('permission-denied', 'Bu aboneliği iptal etme yetkiniz yok.');
            }

            subType = sub.type;

            const now = admin.firestore.Timestamp.now();
            let cancellationDebt = 0;
            const updatePayload: Record<string, any> = {
                status: SubscriptionStatus.EXPIRED,
                cancelledAt: now,
                cancellationReason: data.reason || '',
                updatedAt: now
            };

            if (sub.type === PaymentMethodType.MEMBERSHIP) {
                const membershipSub = sub as MembershipSubscription;
                const elapsedMonths = getElapsedMonthNumber(membershipSub.startDate, now);
                const monthlyPayments = ensureMonthlyPaymentsUpToMonth(membershipSub, elapsedMonths);

                // Kullanılan süreye kadarki ödenmemiş aylık bedeller her durumda borçtur.
                const pendingElapsedDebt = monthlyPayments
                    .filter((p) => p.status === 'pending' && p.month <= elapsedMonths)
                    .reduce((sum, p) => sum + p.amount, 0);

                let discountPaybackDebt = 0;

                // Taahhüt erken bozulursa, kullanılan aylardaki indirimler geri alınır.
                if (membershipSub.hasCommitment && membershipSub.isCommitmentActive) {
                    const consumedCommitmentMonths = Math.min(elapsedMonths, membershipSub.totalMonths);
                    const monthlyDiscount = Math.max(
                        membershipSub.baseMonthlyPrice - membershipSub.monthlyPrice,
                        0
                    );
                    discountPaybackDebt = consumedCommitmentMonths * monthlyDiscount;
                }

                cancellationDebt = pendingElapsedDebt + discountPaybackDebt;

                updatePayload.monthlyPayments = monthlyPayments;
            }

            if (cancellationDebt > 0) {
                updatePayload.cancellationDebt = cancellationDebt;
                // Cayma bedelini mevcut bakiyeye ekle
                updatePayload.currentBalance = (sub.currentBalance || 0) - cancellationDebt;
            }

            transaction.update(subRef, updatePayload);

            // Öğrencinin activeSubscriptionId alanını temizle
            transaction.update(
                db.collection(COLLECTIONS.STUDENTS).doc(sub.studentId),
                { activeSubscriptionId: null, updatedAt: now }
            );

            // Sistem eventi yaz
            const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
            transaction.set(eventRef, {
                id: eventRef.id,
                type: 'subscription_expired',
                gymId: sub.gymId,
                targetUserId: sub.studentId,
                relatedEntityId: data.subscriptionId,
                payload: { cancellationDebt, reason: data.reason || '' },
                createdAt: now,
                notified: false
            });
        });

        // Paket aboneliği iptalinde: pending ve postponed randevuları sil
        if (subType === PaymentMethodType.PACKAGE) {
            const pendingAppointments = await db.collection(COLLECTIONS.APPOINTMENTS)
                .where('subscriptionId', '==', data.subscriptionId)
                .where('status', 'in', ['pending', 'postponed'])
                .get();

            if (!pendingAppointments.empty) {
                const batch = db.batch();
                pendingAppointments.docs.forEach((doc) => batch.delete(doc.ref));
                await batch.commit();
            }
        }

        await logActivity({
            action: LogAction.ASSIGN_SUBSCRIPTION,
            category: LogCategory.SUBSCRIPTION,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.subscriptionId,
                type: 'subscription'
            },
            gymId: '',
            details: { action: 'cancel', reason: data.reason }
        });

        return { success: true, message: 'Abonelik iptal edildi.' };

    } catch (error: any) {
        await logError({
            functionName: 'cancelSubscription',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: data
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Abonelik iptal edilirken bir hata oluştu.');
    }
});