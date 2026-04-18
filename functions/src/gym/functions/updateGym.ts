import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { UpdateGymData } from "../types/gym.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import {
    assertGymTypePaymentCompatibility,
    gymTypeFromPaymentType,
    normalizeGymType,
    normalizePaymentMethod
} from "../utils/paymentValidation";

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

        const currentPaymentType = gymData?.paymentMethod?.type;
        const normalizedGymType = data.gymType ? normalizeGymType(data.gymType) : undefined;
        const normalizedPaymentMethod = data.paymentMethod ? normalizePaymentMethod(data.paymentMethod) : undefined;

        if (normalizedPaymentMethod) {
            const nextGymType = normalizedGymType || gymTypeFromPaymentType(normalizedPaymentMethod.type);
            assertGymTypePaymentCompatibility(nextGymType, normalizedPaymentMethod.type);
            updates.paymentMethod = normalizedPaymentMethod;
            updates.gymType = nextGymType;
        } else if (normalizedGymType) {
            if (currentPaymentType) {
                assertGymTypePaymentCompatibility(normalizedGymType, currentPaymentType);
            }
            updates.gymType = normalizedGymType;
        }

        const nextPaymentType = normalizedPaymentMethod?.type || currentPaymentType;
        const isPaymentModelSwitch =
            currentPaymentType &&
            nextPaymentType &&
            currentPaymentType !== nextPaymentType;

        if (isPaymentModelSwitch) {
            let hasPaidStudent = false;
            let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

            while (true) {
                let query = db.collection(COLLECTIONS.SUBSCRIPTIONS)
                    .where('gymId', '==', data.gymId)
                    .limit(200);

                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();
                if (snapshot.empty) {
                    break;
                }

                if (snapshot.docs.some((doc) => Number(doc.data()?.totalPaid || 0) > 0)) {
                    hasPaidStudent = true;
                    break;
                }

                lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }

            if (hasPaidStudent) {
                throw new HttpsError(
                    'failed-precondition',
                    'Salonda ödemesi olan öğrenci varken salon tipi/ödeme modeli değiştirilemez.'
                );
            }
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

        void logError({
            functionName: 'updateGym',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
