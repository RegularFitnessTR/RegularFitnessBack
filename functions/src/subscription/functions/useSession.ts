import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription } from "../types/subscription.model";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const useSession = onCall(async (request) => {
    // Only student can use sessions
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece öğrenciler tarafından yapılabilir.');
    }

    const studentId = request.auth.uid;

    try {
        // Get student's active subscription
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        const studentData = studentDoc.data();
        const subscriptionId = studentData?.activeSubscriptionId;

        if (!subscriptionId) {
            throw new HttpsError('failed-precondition', 'Aktif aboneliğiniz bulunmuyor.');
        }

        // Get subscription
        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();

        if (!subscriptionDoc.exists) {
            throw new HttpsError('not-found', 'Abonelik bulunamadı.');
        }

        const subscription = subscriptionDoc.data();

        // Only package subscriptions use sessions
        if (subscription?.type !== PaymentMethodType.PACKAGE) {
            throw new HttpsError('invalid-argument', 'Bu abonelik paket bazlı değil.');
        }

        const packageSub = subscription as PackageSubscription;

        // Check if sessions are available
        if (packageSub.sessionsUsed >= packageSub.totalSessions) {
            throw new HttpsError('resource-exhausted', 'Paket dersleri tamamlandı. Yeni paket ataması gerekiyor.');
        }

        // Update subscription - only track usage, debt is already set
        const newSessionsUsed = packageSub.sessionsUsed + 1;
        const newSessionsRemaining = packageSub.totalSessions - newSessionsUsed;

        // currentBalance stays the same (totalPaid - totalDebt)
        // No need to recalculate since totalDebt is fixed at package assignment

        await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).update({
            sessionsUsed: newSessionsUsed,
            sessionsRemaining: newSessionsRemaining,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Calculate current balance for response
        const currentBalance = packageSub.totalPaid - packageSub.totalDebt;

        // Log kaydı - gymId'yi coach üzerinden bul
        let gymId: string | undefined;
        if (studentData?.coachId) {
            const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(studentData.coachId).get();
            gymId = coachDoc.data()?.gymId;
        }

        await logActivity({
            action: LogAction.USE_SESSION,
            category: LogCategory.SUBSCRIPTION,
            performedBy: {
                uid: studentId,
                role: 'student',
                name: request.auth!.token.name || 'Student'
            },
            targetEntity: {
                id: subscriptionId,
                type: 'subscription',
                name: `Ders Kullanımı`
            },
            gymId: gymId,
            details: { sessionsUsed: newSessionsUsed, sessionsRemaining: newSessionsRemaining }
        });

        return {
            success: true,
            message: "Ders kullanımı kaydedildi.",
            sessionsUsed: newSessionsUsed,
            sessionsRemaining: newSessionsRemaining,
            currentBalance: currentBalance
        };

    } catch (error: any) {
        console.error("Ders kullanımı hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
