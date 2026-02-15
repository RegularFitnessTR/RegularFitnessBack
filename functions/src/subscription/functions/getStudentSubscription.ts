import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";

export const getStudentSubscription = onCall(async (request) => {
    // 1. Verify user is authenticated
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { studentId } = request.data;

    if (!studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        // 2. Get student document
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();
        const subscriptionId = studentData?.activeSubscriptionId;

        if (!subscriptionId) {
            return {
                success: true,
                subscription: null,
                message: "Öğrenciye henüz abonelik atanmamış."
            };
        }

        // 3. Get subscription document
        const subscriptionDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscriptionId).get();

        if (!subscriptionDoc.exists) {
            return {
                success: true,
                subscription: null,
                message: "Abonelik bulunamadı."
            };
        }

        return {
            success: true,
            subscription: subscriptionDoc.data()
        };

    } catch (error: any) {
        console.error("Abonelik getirme hatası:", error);

        await logError({
            functionName: 'getStudentSubscription',
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
