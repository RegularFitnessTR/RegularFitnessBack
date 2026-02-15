import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";

export const getStudentBalance = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { studentId } = request.data;

    // Verify authorization
    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    const { role } = request.auth.token;

    // Students can only see their own balance
    if (role === 'student' && studentId !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Başka öğrencinin bakiyesini görüntüleyemezsiniz.');
    }

    try {
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();
        const subscriptionId = studentData?.activeSubscriptionId;

        if (!subscriptionId) {
            return {
                success: true,
                hasSubscription: false,
                message: "Öğrenciye henüz abonelik atanmamış."
            };
        }

        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();

        if (!subscriptionDoc.exists) {
            return {
                success: true,
                hasSubscription: false,
                message: "Abonelik bulunamadı."
            };
        }

        const subscription = subscriptionDoc.data();

        return {
            success: true,
            hasSubscription: true,
            subscription: {
                type: subscription?.type,
                totalDebt: subscription?.totalDebt || subscription?.totalAmount,
                totalPaid: subscription?.totalPaid,
                currentBalance: subscription?.currentBalance,
                status: subscription?.status
            }
        };

    } catch (error: any) {
        console.error("Bakiye sorgulama hatası:", error);

        await logError({
            functionName: 'getStudentBalance',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
