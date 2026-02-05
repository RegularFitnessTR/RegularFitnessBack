import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { Gym } from "../types/gym.model";
import { CreateGymData } from "../types/gym.dto";
import { PaymentMethodType } from "../types/gym.enums";

export const createGym = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as CreateGymData;

    // 2. Validate required fields
    if (!data.name || !data.amenities || !data.address || !data.phoneNumber) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Salon adı, imkanlar, adres ve telefon zorunludur.'
        );
    }

    // Validate address fields
    if (!data.address.street || !data.address.city || !data.address.state || !data.address.zipCode) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik adres bilgisi: Sokak, şehir, eyalet ve posta kodu zorunludur.'
        );
    }

    // Validate gymType
    if (!data.gymType) {
        throw new HttpsError('invalid-argument', 'Salon türü belirtilmesi zorunludur.');
    }

    // Validate paymentMethod
    if (!data.paymentMethod || !data.paymentMethod.type) {
        throw new HttpsError('invalid-argument', 'Ödeme yöntemi belirtilmesi zorunludur.');
    }

    // Validate based on payment method type
    if (data.paymentMethod.type === PaymentMethodType.PACKAGE) {
        if (!data.paymentMethod.packages || data.paymentMethod.packages.length === 0) {
            throw new HttpsError('invalid-argument', 'En az bir paket tanımlanmalıdır.');
        }
        // Validate each package
        for (const pkg of data.paymentMethod.packages) {
            if (!pkg.name || !pkg.sessionCount || !pkg.basePrice) {
                throw new HttpsError(
                    'invalid-argument',
                    'Her paketin adı, ders sayısı ve fiyatı belirtilmelidir.'
                );
            }
        }
    } else if (data.paymentMethod.type === PaymentMethodType.MEMBERSHIP) {
        if (!data.paymentMethod.monthly || !data.paymentMethod.sixMonths || !data.paymentMethod.yearly) {
            throw new HttpsError('invalid-argument', 'Tüm üyelik planları tanımlanmalıdır.');
        }
        // Validate each membership plan
        if (!data.paymentMethod.monthly.name || !data.paymentMethod.monthly.price) {
            throw new HttpsError('invalid-argument', 'Aylık üyelik bilgileri eksik.');
        }
        if (!data.paymentMethod.sixMonths.name || !data.paymentMethod.sixMonths.price) {
            throw new HttpsError('invalid-argument', '6 aylık üyelik bilgileri eksik.');
        }
        if (!data.paymentMethod.yearly.name || !data.paymentMethod.yearly.price) {
            throw new HttpsError('invalid-argument', 'Yıllık üyelik bilgileri eksik.');
        }
    }

    try {
        // 3. Create gym document
        const gymRef = db.collection(COLLECTIONS.GYMS).doc();
        const gymId = gymRef.id;

        const newGym: Gym = {
            id: gymId,
            name: data.name,
            ownerId: request.auth.uid,
            gymType: data.gymType,
            paymentMethod: data.paymentMethod,
            amenities: data.amenities,
            address: data.address,
            phoneNumber: data.phoneNumber,
            socialMedia: data.socialMedia || [],
            createdAt: admin.firestore.Timestamp.now()
        };

        await gymRef.set(newGym);

        // 4. Update admin's gymIds array
        await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).update({
            gymIds: admin.firestore.FieldValue.arrayUnion(gymId),
            updatedAt: admin.firestore.Timestamp.now()
        });

        return {
            success: true,
            message: "Spor salonu başarıyla oluşturuldu.",
            gymId: gymId
        };

    } catch (error: any) {
        console.error("Gym oluşturma hatası:", error);

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
