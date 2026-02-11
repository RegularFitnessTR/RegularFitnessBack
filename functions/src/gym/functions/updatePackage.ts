import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { Package } from "../types/gym.payment";

interface UpdatePackageData {
    gymId: string;
    packageIndex: number;
    package: Package;
}

export const updatePackage = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as UpdatePackageData;
    if (!data.gymId || data.packageIndex === undefined || !data.package) {
        throw new HttpsError('invalid-argument', 'Gym ID, paket indexi ve yeni paket bilgileri gereklidir.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);

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

            // Update the package, ensuring we keep the array structure
            packages[data.packageIndex] = data.package;

            transaction.update(gymRef, {
                'paymentMethod.packages': packages,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        return { success: true, message: "Paket başarıyla güncellendi." };

    } catch (error: any) {
        console.error("Paket güncelleme hatası:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Paket güncellenirken bir hata oluştu.');
    }
});
