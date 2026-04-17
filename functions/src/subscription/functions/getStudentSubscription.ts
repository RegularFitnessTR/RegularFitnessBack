import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { PackageSubscription, MembershipSubscription } from "../types/subscription.model";
import { logError } from "../../log/utils/logError";

export const getStudentSubscription = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }

    // Öğrenci sadece kendi aboneliğini görebilir
    if (role === 'student' && studentId !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Başka öğrencinin aboneliğini görüntüleyemezsiniz.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data()!;

        // Coach sadece kendi öğrencisinin aboneliğini görebilir
        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        // Admin sadece kendi salonundaki öğrencilerin aboneliğini görebilir
        if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(studentData.gymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrencinin salonuna erişim yetkiniz yok.');
            }
        }
        const subscriptionId = studentData.activeSubscriptionId;

        if (!subscriptionId) {
            return { success: true, subscription: null, message: 'Aktif abonelik yok.' };
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();
        if (!subscriptionDoc.exists) {
            return { success: true, subscription: null, message: 'Abonelik bulunamadı.' };
        }

        const sub = subscriptionDoc.data()!;

        // Tipe göre ek bilgileri ekle
        if (sub.type === PaymentMethodType.PACKAGE) {
            const packageSub = sub as PackageSubscription;

            // Pakete ait randevuları da getir
            const appointmentsQuery = await db.collection(COLLECTIONS.APPOINTMENTS)
                .where('subscriptionId', '==', subscriptionId)
                .orderBy('sessionNumber', 'asc')
                .get();

            const appointments = appointmentsQuery.docs.map(d => d.data());

            return {
                success: true,
                subscription: serializeTimestamps({
                    ...packageSub,
                    appointments
                })
            };

        } else {
            const membershipSub = sub as MembershipSubscription;

            // Taahhüt durumu özeti
            const now = Date.now();
            const commitmentDaysRemaining = membershipSub.isCommitmentActive && membershipSub.commitmentEndsAt
                ? Math.ceil((membershipSub.commitmentEndsAt.toMillis() - now) / (1000 * 60 * 60 * 24))
                : 0;

            // Yaklaşan ödeme
            const nextPendingPayment = (membershipSub.monthlyPayments || [])
                .find(p => p.status === 'pending') || null;

            return {
                success: true,
                subscription: serializeTimestamps({
                    ...membershipSub,
                    // Hesaplanan ek alanlar
                    commitmentDaysRemaining: Math.max(0, commitmentDaysRemaining),
                    nextPendingPayment,
                    effectiveMonthlyPrice: membershipSub.isCommitmentActive
                        ? membershipSub.monthlyPrice
                        : membershipSub.baseMonthlyPrice
                })
            };
        }

    } catch (error: any) {
        await logError({
            functionName: 'getStudentSubscription',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});