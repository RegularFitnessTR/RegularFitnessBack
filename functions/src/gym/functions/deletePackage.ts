import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface DeletePackageData {
    gymId: string;
    packageIndex: number;
}

export const deletePackage = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as DeletePackageData;
    if (!data.gymId || data.packageIndex === undefined) {
        throw new HttpsError('invalid-argument', 'Gym ID ve paket indexi gereklidir.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);

        let packageName = "";

        await db.runTransaction(async (transaction) => {
            const gymDoc = await transaction.get(gymRef);
            if (!gymDoc.exists) {
                throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
            }

            const gymData = gymDoc.data();
            if (gymData?.ownerId !== request.auth!.uid && role !== 'superadmin') {
                throw new HttpsError('permission-denied', 'Bu spor salonunu güncelleme yetkiniz yok.');
            }

            if (gymData?.paymentMethod?.type !== PaymentMethodType.PACKAGE) {
                throw new HttpsError('failed-precondition', 'Bu spor salonu paket bazlı ödeme yöntemini kullanmıyor.');
            }

            const packages = gymData.paymentMethod.packages || [];
            if (data.packageIndex < 0 || data.packageIndex >= packages.length) {
                throw new HttpsError('out-of-range', 'Geçersiz paket indexi.');
            }

            packageName = packages[data.packageIndex].name;
            
            // Remove the package at the specified index
            packages.splice(data.packageIndex, 1);

            transaction.update(gymRef, {
                'paymentMethod.packages': packages,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        // Log kaydı
        await logActivity({
            action: LogAction.DELETE_PACKAGE,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.gymId,
                type: 'gym'
            },
            gymId: data.gymId,
            details: { packageIndex: data.packageIndex, packageName: packageName }
        });

        return { success: true, message: "Paket başarıyla silindi." };

    } catch (error: any) {
        console.error("Paket silme hatası:", error);

        await logError({
            functionName: 'deletePackage',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Paket silinirken bir hata oluştu.');
    }
});
