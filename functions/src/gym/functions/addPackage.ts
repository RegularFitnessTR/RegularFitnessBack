import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { Package } from "../types/gym.payment";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface AddPackageData {
    gymId: string;
    package: Package;
}

export const addPackage = onCall(async (request) => {
    // 1. Auth check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as AddPackageData;
    if (!data.gymId || !data.package) {
        throw new HttpsError('invalid-argument', 'Gym ID ve paket bilgileri gereklidir.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);
        const gymDoc = await gymRef.get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();

        // Check ownership
        if (gymData?.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu spor salonuna paket ekleme yetkiniz yok.');
        }

        // 2. Validate Payment Method Type
        if (gymData?.paymentMethod?.type !== PaymentMethodType.PACKAGE) {
            throw new HttpsError('failed-precondition', 'Bu spor salonu paket bazlı ödeme yöntemini kullanmıyor.');
        }

        // 3. Add Package
        await gymRef.update({
            'paymentMethod.packages': admin.firestore.FieldValue.arrayUnion(data.package),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Log kaydı
        await logActivity({
            action: LogAction.ADD_PACKAGE,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.gymId,
                type: 'gym',
                name: gymData?.name
            },
            gymId: data.gymId,
            details: { packageName: data.package.name }
        });

        return { success: true, message: "Paket başarıyla eklendi." };

    } catch (error: any) {
        console.error("Paket ekleme hatası:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Paket eklenirken bir hata oluştu.');
    }
});
