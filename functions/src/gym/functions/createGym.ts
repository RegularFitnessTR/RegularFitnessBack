import * as admin from "firebase-admin";
import { db, COLLECTIONS, syncGymClaims, onCall, HttpsError } from "../../common";
import { Gym } from "../types/gym.model";
import { CreateGymData } from "../types/gym.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { v4 as uuidv4 } from 'uuid';
import {
    assertGymTypePaymentCompatibility,
    normalizeGymType,
    normalizePaymentMethod
} from "../utils/paymentValidation";

export const createGym = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as CreateGymData;

    if (!data.name || !data.amenities || !data.address || !data.phoneNumber) {
        throw new HttpsError('invalid-argument', 'Eksik bilgi: Salon adı, imkanlar, adres ve telefon zorunludur.');
    }

    if (!data.address.street || !data.address.city || !data.address.state || !data.address.zipCode) {
        throw new HttpsError('invalid-argument', 'Eksik adres bilgisi.');
    }

    if (!data.gymType) {
        throw new HttpsError('invalid-argument', 'Salon türü belirtilmesi zorunludur.');
    }

    if (!data.paymentMethod) {
        throw new HttpsError('invalid-argument', 'Salon oluştururken ödeme yöntemi belirtilmesi zorunludur.');
    }

    const normalizedGymType = normalizeGymType(data.gymType);
    const normalizedPaymentMethod = normalizePaymentMethod(data.paymentMethod);
    assertGymTypePaymentCompatibility(normalizedGymType, normalizedPaymentMethod.type);

    try {
        const publicId = uuidv4();
        const gymRef = db.collection(COLLECTIONS.GYMS).doc();
        const gymId = gymRef.id;
        const photoUrl = typeof data.photoUrl === 'string' ? data.photoUrl.trim() : undefined;

        const newGym: Gym = {
            id: gymId,
            publicId,
            name: data.name,
            ownerId: request.auth.uid,
            gymType: normalizedGymType,
            amenities: data.amenities,
            address: data.address,
            phoneNumber: data.phoneNumber,
            socialMedia: data.socialMedia || [],
            paymentMethod: normalizedPaymentMethod,
            createdAt: admin.firestore.Timestamp.now()
        };

        if (photoUrl) {
            newGym.photoUrl = photoUrl;
        }

        // Gym ve admin güncellemesini batch ile atomik yaz
        const gymBatch = db.batch();
        gymBatch.set(gymRef, newGym);
        gymBatch.update(db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid), {
            gymIds: admin.firestore.FieldValue.arrayUnion(gymId),
            updatedAt: admin.firestore.Timestamp.now()
        });
        await gymBatch.commit();

        // Admin claims'ine yeni gymId'yi ekle
        const updatedAdminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
        const updatedGymIds: string[] = updatedAdminDoc.data()?.gymIds || [];
        await syncGymClaims(request.auth.uid, { gymIds: updatedGymIds });

        await logActivity({
            action: LogAction.CREATE_GYM,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: { id: gymId, type: 'gym', name: data.name },
            gymId
        });

        return { success: true, message: "Spor salonu başarıyla oluşturuldu.", gymId, publicId };

    } catch (error: any) {
        await logError({
            functionName: 'createGym',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { name: data.name, gymType: normalizedGymType }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});