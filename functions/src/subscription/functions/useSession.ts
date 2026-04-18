import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { GymType, PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription } from "../types/subscription.model";
import { SubscriptionStatus } from "../types/subscription.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const useSession = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece öğrenciler tarafından yapılabilir.');
    }

    const studentId = request.auth.uid;

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }
        const studentData = studentDoc.data()!;
        const subscriptionId = studentData.activeSubscriptionId;

        if (!subscriptionId) {
            throw new HttpsError('failed-precondition', 'Aktif aboneliğiniz bulunmuyor.');
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();
        if (!subscriptionDoc.exists) {
            throw new HttpsError('not-found', 'Abonelik bulunamadı.');
        }

        const subscription = subscriptionDoc.data();

        if (subscription?.type !== PaymentMethodType.PACKAGE) {
            throw new HttpsError('invalid-argument', 'Bu abonelik paket bazlı değil.');
        }

        // Salon tipini kontrol et — reformer salonunda bu fonksiyon kullanılamaz,
        // seans düşürme sadece completeAppointment üzerinden yapılır
        const gymId: string | undefined = subscription.gymId;
        if (gymId) {
            const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
            const gymData = gymDoc.data();
            if (gymData?.gymType === GymType.REFORMER) {
                throw new HttpsError(
                    'failed-precondition',
                    'Bu salon randevu sistemi kullanıyor. Seans düşürme işlemi hoca tarafından randevu tamamlama üzerinden yapılmalıdır.'
                );
            }
        }

        const packageSub = subscription as PackageSubscription;

        if (packageSub.sessionsRemaining <= 0) {
            throw new HttpsError('resource-exhausted', 'Paket dersleri tamamlandı. Yeni paket ataması gerekiyor.');
        }

        const newSessionsUsed = packageSub.sessionsUsed + 1;
        const newSessionsRemaining = packageSub.sessionsRemaining - 1;
        const totalPackageDebt = packageSub.totalSessions * packageSub.pricePerSession;
        const currentBalance = packageSub.totalPaid - totalPackageDebt;

        const newStatus = newSessionsRemaining === 0
            ? SubscriptionStatus.EXPIRED
            : SubscriptionStatus.ACTIVE;

        const batch = db.batch();

        batch.update(subscriptionDoc.ref, {
            sessionsUsed: newSessionsUsed,
            sessionsRemaining: newSessionsRemaining,
            totalDebt: totalPackageDebt,
            currentBalance,
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.now()
        });

        if (newStatus === SubscriptionStatus.EXPIRED) {
            batch.update(
                db.collection(COLLECTIONS.STUDENTS).doc(studentId),
                { activeSubscriptionId: null, updatedAt: admin.firestore.Timestamp.now() }
            );
        }

        await batch.commit();

        void logActivity({
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
                name: 'Ders Kullanımı'
            },
            gymId,
            details: { sessionsUsed: newSessionsUsed, sessionsRemaining: newSessionsRemaining }
        });

        return {
            success: true,
            message: 'Ders kullanımı kaydedildi.',
            sessionsUsed: newSessionsUsed,
            sessionsRemaining: newSessionsRemaining,
            currentBalance
        };

    } catch (error: any) {
        void logError({
            functionName: 'useSession',
            error,
            userId: request.auth?.uid,
            userRole: role
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});