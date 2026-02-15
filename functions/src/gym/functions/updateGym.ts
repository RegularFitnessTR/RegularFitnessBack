import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { UpdateGymData } from "../types/gym.dto";
import { PaymentMethodType } from "../types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const updateGym = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as UpdateGymData;

    if (!data.gymId) {
        throw new HttpsError(
            'invalid-argument',
            'Gym ID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Verify gym exists and admin owns it
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(data.gymId).get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();

        // Verify ownership (either owner or superadmin)
        if (gymData?.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError(
                'permission-denied',
                'Bu spor salonunu güncelleme yetkiniz yok.'
            );
        }

        // 3. Prepare updates
        const updates: any = {};

        if (data.name) {
            updates.name = data.name;
        }

        if (data.gymType) {
            updates.gymType = data.gymType;
        }

        if (data.paymentMethod) {
            // Validate payment method if provided
            if (data.paymentMethod.type === PaymentMethodType.PACKAGE) {
                if (!data.paymentMethod.packages || data.paymentMethod.packages.length === 0) {
                    throw new HttpsError('invalid-argument', 'En az bir paket tanımlanmalıdır.');
                }
            } else if (data.paymentMethod.type === PaymentMethodType.MEMBERSHIP) {
                if (!data.paymentMethod.monthly || !data.paymentMethod.sixMonths || !data.paymentMethod.yearly) {
                    throw new HttpsError('invalid-argument', 'Tüm üyelik planları tanımlanmalıdır.');
                }
            }
            updates.paymentMethod = data.paymentMethod;
        }

        if (data.amenities) {
            updates.amenities = data.amenities;
        }

        if (data.address) {
            // Merge with existing address
            updates.address = {
                ...gymData?.address,
                ...data.address
            };
        }

        if (data.phoneNumber) {
            updates.phoneNumber = data.phoneNumber;
        }

        if (data.socialMedia !== undefined) {
            updates.socialMedia = data.socialMedia;
        }

        updates.updatedAt = admin.firestore.Timestamp.now();

        // 4. Apply updates
        if (Object.keys(updates).length > 0) {
            await db.collection(COLLECTIONS.GYMS).doc(data.gymId).update(updates);
        }

        // Log kaydı
        await logActivity({
            action: LogAction.UPDATE_GYM,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: {
                id: data.gymId,
                type: 'gym',
                name: gymData?.name
            },
            gymId: data.gymId,
            details: { updatedFields: Object.keys(updates) }
        });

        return {
            success: true,
            message: "Spor salonu başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Gym güncelleme hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
