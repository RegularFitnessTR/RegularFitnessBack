
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PackageSubscription, MembershipSubscription, MonthlyPayment } from "../types/subscription.model";
import { SubscriptionStatus } from "../types/subscription.enums";
import { AssignPackageSubscriptionData, AssignMembershipSubscriptionData } from "../types/subscription.dto";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const assignSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için hoca veya admin yetkisi gereklidir.');
    }

    const data = request.data as AssignPackageSubscriptionData | AssignMembershipSubscriptionData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();

        if (role === 'coach') {
            if (studentData?.coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
            }
        }

        const coachId = studentData?.coachId;
        if (!coachId) {
            throw new HttpsError('invalid-argument', 'Öğrenciye henüz hoca atanmamış.');
        }

        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachId).get();
        const coachData = coachDoc.data();
        const gymId = coachData?.gymId;

        if (!gymId) {
            throw new HttpsError('invalid-argument', 'Hoca bir spor salonuna atanmamış.');
        }

        // Fetch gym document to validate payment method
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();
        const gymPaymentMethod = gymData?.paymentMethod;

        if (!gymPaymentMethod) {
            throw new HttpsError('failed-precondition', 'Bu spor salonuna henüz ödeme yöntemi tanımlanmamış.');
        }

        const subscriptionRef = db.collection(COLLECTIONS.SUBSCRIPTIONS).doc();
        const subscriptionId = subscriptionRef.id;

        let newSubscription: PackageSubscription | MembershipSubscription;

        if ('packageName' in data) {
            // Validate: gym must have PACKAGE payment type
            if (gymPaymentMethod.type !== PaymentMethodType.PACKAGE) {
                throw new HttpsError('invalid-argument', 'Bu spor salonu paket bazlı ödeme yöntemi kullanmıyor.');
            }

            // Validate: the package must exist in gym's defined packages
            const matchingPackage = gymPaymentMethod.packages?.find(
                (pkg: any) =>
                    pkg.name === data.packageName &&
                    pkg.totalSessions === data.totalSessions &&
                    pkg.pricePerSession === data.pricePerSession
            );

            if (!matchingPackage) {
                throw new HttpsError(
                    'invalid-argument',
                    'Seçilen paket bu spor salonunun tanımlı paketleri arasında bulunamadı.'
                );
            }

            // Package-based subscription
            const totalPackageDebt = data.totalSessions * data.pricePerSession;

            newSubscription = {
                id: subscriptionId,
                studentId: data.studentId,
                coachId: coachId,
                gymId: gymId,
                type: PaymentMethodType.PACKAGE,
                packageName: data.packageName,
                pricePerSession: data.pricePerSession,
                totalSessions: data.totalSessions,

                // Session tracking - starts at 0
                sessionsUsed: 0,
                sessionsRemaining: data.totalSessions,

                // Debt tracking - FULL DEBT IMMEDIATELY
                totalDebt: totalPackageDebt,  // Complete package debt from start
                totalPaid: 0,
                currentBalance: -totalPackageDebt,  // Negative = student owes money

                status: SubscriptionStatus.ACTIVE,
                assignedAt: admin.firestore.Timestamp.now(),
                assignedBy: request.auth.uid
            };
        } else {
            // Validate: gym must have MEMBERSHIP payment type
            if (gymPaymentMethod.type !== PaymentMethodType.MEMBERSHIP) {
                throw new HttpsError('invalid-argument', 'Bu spor salonu üyelik bazlı ödeme yöntemi kullanmıyor.');
            }

            // Validate: the membership plan must match gym's defined plan
            const planKey = data.membershipType; // 'monthly' | 'sixMonths' | 'yearly'
            const gymPlan = gymPaymentMethod[planKey];

            if (!gymPlan) {
                throw new HttpsError('invalid-argument', `Bu spor salonunda "${planKey}" üyelik planı tanımlı değil.`);
            }

            if (gymPlan.monthlyPrice !== data.monthlyPayment) {
                throw new HttpsError(
                    'invalid-argument',
                    'Girilen aylık ödeme tutarı, spor salonunun tanımlı planıyla uyuşmuyor.'
                );
            }

            if (gymPlan.durationMonths !== data.totalMonths) {
                throw new HttpsError(
                    'invalid-argument',
                    'Girilen süre, spor salonunun tanımlı planıyla uyuşmuyor.'
                );
            }

            // Membership-based subscription
            const now = admin.firestore.Timestamp.now();
            const nowMs = now.toMillis();
            const monthMs = 30 * 24 * 60 * 60 * 1000; // Approximate month

            // Calculate end date
            const endDateMs = nowMs + (data.totalMonths * monthMs);
            const endDate = admin.firestore.Timestamp.fromMillis(endDateMs);

            // Create monthly payment array
            const monthlyPayments: MonthlyPayment[] = [];
            for (let i = 0; i < data.totalMonths; i++) {
                const dueDateMs = nowMs + (i * monthMs);
                monthlyPayments.push({
                    month: i + 1,
                    dueDate: admin.firestore.Timestamp.fromMillis(dueDateMs),
                    amount: data.monthlyPayment,
                    status: 'pending'
                });
            }

            const totalAmount = data.monthlyPayment * data.totalMonths;

            newSubscription = {
                id: subscriptionId,
                studentId: data.studentId,
                coachId: coachId,
                gymId: gymId,
                type: PaymentMethodType.MEMBERSHIP,
                membershipType: data.membershipType,
                membershipName: data.membershipName,
                monthlyPayment: data.monthlyPayment,
                totalMonths: data.totalMonths,
                totalAmount: totalAmount,

                startDate: now,
                endDate: endDate,

                monthlyPayments: monthlyPayments,

                totalPaid: 0,
                currentBalance: -totalAmount,  // Negative = debt

                status: SubscriptionStatus.ACTIVE,
                assignedAt: now,
                assignedBy: request.auth.uid
            };
        }

        await subscriptionRef.set(newSubscription);

        await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).update({
            activeSubscriptionId: subscriptionId,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        await logActivity({
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
                name: `Abonelik - ${'packageName' in data ? data.packageName : data.membershipName} `
            },
            gymId: gymId,
            details: { studentId: data.studentId, type: newSubscription.type }
        });

        return {
            success: true,
            message: "Abonelik başarıyla atandı.",
            subscriptionId: subscriptionId
        };

    } catch (error: any) {
        console.error("Abonelik atama hatası:", error);

        await logError({
            functionName: 'assignSubscription',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId: data.studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
