import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { PackageSubscription, MembershipSubscription } from "../types/subscription.model";
import { SubscriptionStatus } from "../types/subscription.enums";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { MembershipPlan } from "../../gym/types/gym.payment";
import { SystemEvent, SystemEventType } from "../../notification/types/system-event.model";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { ensureMonthlyPaymentsUpToMonth, MembershipPaymentSource } from "../utils/membershipPayments";

// --- DTO ---

interface AssignPackageSubscriptionData {
    studentId: string;
    packageName: string;
    totalSessions: number;
    pricePerSession: number;
}

interface AssignMembershipSubscriptionData {
    studentId: string;
    planId: string;           // gym.paymentMethod.plans içindeki plan id
    billingDayOfMonth: number; // 1-28 arası
}

type AssignSubscriptionData = AssignPackageSubscriptionData | AssignMembershipSubscriptionData;

// --- Yardımcı ---

function isPackageData(data: AssignSubscriptionData): data is AssignPackageSubscriptionData {
    return 'packageName' in data;
}

async function writeSystemEvent(
    type: SystemEventType,
    gymId: string,
    targetUserId: string,
    relatedEntityId: string,
    payload: Record<string, any>
): Promise<void> {
    const eventRef = db.collection(COLLECTIONS.SYSTEM_EVENTS).doc();
    const event: SystemEvent = {
        id: eventRef.id,
        type,
        gymId,
        targetUserId,
        relatedEntityId,
        payload,
        createdAt: admin.firestore.Timestamp.now(),
        notified: false
    };
    await eventRef.set(event);
}

// --- Ana fonksiyon ---

export const assignSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca veya admin yetkisi gereklidir.');
    }

    const data = request.data as AssignSubscriptionData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }

    if (!isPackageData(data)) {
        if (!data.planId) {
            throw new HttpsError('invalid-argument', 'Plan ID zorunludur.');
        }
        if (!data.billingDayOfMonth || data.billingDayOfMonth < 1 || data.billingDayOfMonth > 28) {
            throw new HttpsError('invalid-argument', 'Tahsilat günü 1-28 arasında olmalıdır.');
        }
    }

    try {
        // 1. Öğrenciyi getir
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }
        const studentData = studentDoc.data()!;

        // 2. Yetki kontrolü
        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        // 3. Hoca ve gym bilgisini al
        const coachId = studentData.coachId;
        if (!coachId) {
            throw new HttpsError('failed-precondition', 'Öğrenciye henüz hoca atanmamış.');
        }

        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
        if (!coachDoc.exists) {
            throw new HttpsError('not-found', 'Hoca bulunamadı.');
        }
        const gymId: string = coachDoc.data()!.gymId;
        if (!gymId) {
            throw new HttpsError('failed-precondition', 'Hoca bir salona atanmamış.');
        }

        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrencinin salonuna erişim yetkiniz yok.');
            }
        }

        // 4. Gym'i getir
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }
        const gymData = gymDoc.data()!;
        const paymentMethod = gymData.paymentMethod;

        if (!paymentMethod) {
            throw new HttpsError('failed-precondition', 'Bu salona ödeme yöntemi tanımlanmamış.');
        }

        const subscriptionRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc();
        const subscriptionId = subscriptionRef.id;
        const now = admin.firestore.Timestamp.now();

        let newSubscription: PackageSubscription | MembershipSubscription;

        // 6a. Paket bazlı
        if (isPackageData(data)) {
            if (paymentMethod.type !== PaymentMethodType.PACKAGE) {
                throw new HttpsError('invalid-argument', 'Bu salon paket bazlı ödeme kullanmıyor.');
            }

            const matchingPackage = paymentMethod.packages?.find(
                (pkg: any) => pkg.name === data.packageName
            );

            if (!matchingPackage) {
                throw new HttpsError('invalid-argument', 'Seçilen paket bu salonun tanımlı paketleri arasında bulunamadı.');
            }

            const totalSessions = matchingPackage.totalSessions;
            const pricePerSession = matchingPackage.pricePerSession;
            const totalDebt = totalSessions * pricePerSession;

            newSubscription = {
                id: subscriptionId,
                studentId: data.studentId,
                coachId,
                gymId,
                type: PaymentMethodType.PACKAGE,
                packageName: matchingPackage.name,
                pricePerSession,
                totalSessions,
                sessionsUsed: 0,
                sessionsRemaining: totalSessions,
                totalDebt,
                totalPaid: 0,
                currentBalance: -totalDebt,
                status: SubscriptionStatus.ACTIVE,
                assignedAt: now,
                assignedBy: request.auth.uid
            } as PackageSubscription;

            // 6b. Üyelik bazlı
        } else {
            if (paymentMethod.type !== PaymentMethodType.MEMBERSHIP) {
                throw new HttpsError('invalid-argument', 'Bu salon üyelik bazlı ödeme kullanmıyor.');
            }

            const plans: MembershipPlan[] = paymentMethod.plans || [];
            const selectedPlan = plans.find((p: MembershipPlan) => p.id === data.planId);

            if (!selectedPlan) {
                throw new HttpsError('not-found', 'Seçilen plan bu salonun tanımlı planları arasında bulunamadı.');
            }

            // Baz fiyatı bul (isBase=true olan plan)
            const basePlan = plans.find((p: MembershipPlan) => p.isBase);
            if (!basePlan) {
                throw new HttpsError('failed-precondition', 'Bu salonda baz plan tanımlı değil.');
            }

            // Taahhüt bitiş tarihini hesapla
            let commitmentEndsAt: admin.firestore.Timestamp | undefined;
            if (selectedPlan.hasCommitment) {
                const commitEndDate = new Date(now.toMillis());
                commitEndDate.setMonth(commitEndDate.getMonth() + selectedPlan.durationMonths);
                commitmentEndsAt = admin.firestore.Timestamp.fromDate(commitEndDate);
            }

            const seedMembership: MembershipPaymentSource = {
                startDate: now,
                billingDayOfMonth: data.billingDayOfMonth,
                hasCommitment: selectedPlan.hasCommitment,
                totalMonths: selectedPlan.durationMonths,
                monthlyPrice: selectedPlan.monthlyPrice,
                baseMonthlyPrice: basePlan.monthlyPrice,
                monthlyPayments: []
            };

            // İlk atamada taahhüt süresine kadar ödeme satırı üret, sonrası gerektiğinde dinamik genişletilir.
            const monthlyPayments = ensureMonthlyPaymentsUpToMonth(
                seedMembership,
                Math.max(1, selectedPlan.durationMonths)
            );

            // endDate: taahhütlü ise taahhüt sonu, değilse 1 ay sonrası (açık uçlu)
            const endDate = selectedPlan.hasCommitment && commitmentEndsAt
                ? commitmentEndsAt
                : admin.firestore.Timestamp.fromMillis(
                    now.toMillis() + 30 * 24 * 60 * 60 * 1000
                );

            newSubscription = {
                id: subscriptionId,
                studentId: data.studentId,
                coachId,
                gymId,
                type: PaymentMethodType.MEMBERSHIP,
                planId: selectedPlan.id,
                planName: selectedPlan.name,
                monthlyPrice: selectedPlan.monthlyPrice,
                totalMonths: selectedPlan.durationMonths,
                totalAmount: selectedPlan.totalPrice,
                hasCommitment: selectedPlan.hasCommitment,
                ...(commitmentEndsAt ? { commitmentEndsAt } : {}),
                isCommitmentActive: selectedPlan.hasCommitment,
                baseMonthlyPrice: basePlan.monthlyPrice,
                startDate: now,
                endDate,
                billingDayOfMonth: data.billingDayOfMonth,
                monthlyPayments,
                totalPaid: 0,
                currentBalance: -selectedPlan.totalPrice,
                status: SubscriptionStatus.ACTIVE,
                assignedAt: now,
                assignedBy: request.auth.uid
            } as MembershipSubscription;
        }

        // 7. Transaction: active sub re-check + write atomik
        await db.runTransaction(async (tx) => {
            const existingSubs = await tx.get(
                db.collection(COLLECTIONS.SUBSCRIPTIONS)
                    .where('studentId', '==', data.studentId)
                    .where('status', '==', SubscriptionStatus.ACTIVE)
            );
            if (!existingSubs.empty) {
                throw new HttpsError('already-exists', 'Bu öğrencinin zaten aktif bir aboneliği var.');
            }

            tx.set(subscriptionRef, newSubscription);
            tx.update(db.collection(COLLECTIONS.STUDENTS).doc(data.studentId), {
                activeSubscriptionId: subscriptionId,
                updatedAt: now
            });
        });

        // 8. Sistem eventi yaz (bildirim altyapısı için)
        await writeSystemEvent(
            'payment_due',
            gymId,
            data.studentId,
            subscriptionId,
            {
                type: isPackageData(data) ? PaymentMethodType.PACKAGE : PaymentMethodType.MEMBERSHIP,
                planName: isPackageData(data) ? data.packageName : (newSubscription as MembershipSubscription).planName
            }
        );

        void logActivity({
            action: LogAction.ASSIGN_SUBSCRIPTION,
            category: LogCategory.SUBSCRIPTION,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: subscriptionId,
                type: 'subscription',
                name: isPackageData(data) ? data.packageName : (newSubscription as MembershipSubscription).planName
            },
            gymId,
            details: {
                studentId: data.studentId,
                type: newSubscription.type
            }
        });

        return {
            success: true,
            message: 'Abonelik başarıyla atandı.',
            subscriptionId
        };

    } catch (error: any) {
        void logError({
            functionName: 'assignSubscription',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: { studentId: data.studentId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});