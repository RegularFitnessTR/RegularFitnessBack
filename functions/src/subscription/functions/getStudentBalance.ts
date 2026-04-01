import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription, MembershipSubscription } from "../types/subscription.model";
import { logError } from "../../log/utils/logError";

export const getStudentBalance = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }

    if (role === 'student' && studentId !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Başka öğrencinin bakiyesini görüntüleyemezsiniz.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data()!;
        const subscriptionId = studentData.activeSubscriptionId;

        if (!subscriptionId) {
            return { success: true, hasSubscription: false, message: 'Aktif abonelik yok.' };
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();
        if (!subscriptionDoc.exists) {
            return { success: true, hasSubscription: false, message: 'Abonelik bulunamadı.' };
        }

        const sub = subscriptionDoc.data()!;

        if (sub.type === PaymentMethodType.PACKAGE) {
            const packageSub = sub as PackageSubscription;

            return {
                success: true,
                hasSubscription: true,
                type: PaymentMethodType.PACKAGE,
                balance: {
                    totalDebt: packageSub.totalDebt,
                    totalPaid: packageSub.totalPaid,
                    currentBalance: packageSub.currentBalance,   // negatif = borç
                    remainingDebt: packageSub.totalDebt - packageSub.totalPaid,
                    sessionsUsed: packageSub.sessionsUsed,
                    sessionsRemaining: packageSub.sessionsRemaining,
                    totalSessions: packageSub.totalSessions,
                    status: packageSub.status
                }
            };

        } else {
            const membershipSub = sub as MembershipSubscription;

            const paidMonths = (membershipSub.monthlyPayments || [])
                .filter(p => p.status === 'paid').length;
            const pendingMonths = (membershipSub.monthlyPayments || [])
                .filter(p => p.status === 'pending').length;
            const overdueMonths = (membershipSub.monthlyPayments || [])
                .filter(p => p.status === 'pending' && p.dueDate.toMillis() < Date.now()).length;

            const nextPendingPayment = (membershipSub.monthlyPayments || [])
                .find(p => p.status === 'pending') || null;

            // Taahhüt aktifse aylık fiyat, değilse baz fiyat
            const effectiveMonthlyPrice = membershipSub.isCommitmentActive
                ? membershipSub.monthlyPrice
                : membershipSub.baseMonthlyPrice;

            return {
                success: true,
                hasSubscription: true,
                type: PaymentMethodType.MEMBERSHIP,
                balance: {
                    totalPaid: membershipSub.totalPaid,
                    currentBalance: membershipSub.currentBalance,
                    effectiveMonthlyPrice,
                    isCommitmentActive: membershipSub.isCommitmentActive,
                    commitmentEndsAt: membershipSub.commitmentEndsAt || null,
                    cancellationDebt: membershipSub.cancellationDebt || 0,
                    paidMonths,
                    pendingMonths,
                    overdueMonths,
                    nextPendingPayment,
                    status: membershipSub.status
                }
            };
        }

    } catch (error: any) {
        await logError({
            functionName: 'getStudentBalance',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});