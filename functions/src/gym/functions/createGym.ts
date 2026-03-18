import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { Gym } from "../types/gym.model";
import { CreateGymData } from "../types/gym.dto";
import { PaymentMethodType } from "../types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { v4 as uuidv4 } from 'uuid';

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

    // Validate paymentMethod (optional - only validate if provided)
    if (data.paymentMethod) {
        if (!data.paymentMethod.type) {
            throw new HttpsError('invalid-argument', 'Ödeme yöntemi tipi belirtilmesi zorunludur.');
        }

        // Validate based on payment method type
        if (data.paymentMethod.type === PaymentMethodType.PACKAGE) {
            if (!data.paymentMethod.packages || data.paymentMethod.packages.length === 0) {
                throw new HttpsError('invalid-argument', 'En az bir paket tanımlanmalıdır.');
            }
            // Validate each package
            for (const pkg of data.paymentMethod.packages) {
                if (!pkg.name || !pkg.totalSessions || !pkg.totalPrice) {
                    throw new HttpsError(
                        'invalid-argument',
                        'Her paketin adı, toplam ders sayısı ve toplam fiyat belirtilmelidir.'
                    );
                }
                // Calculate pricePerSession if not provided
                if (!pkg.pricePerSession) {
                    pkg.pricePerSession = pkg.totalPrice / pkg.totalSessions;
                }
            }
        } else if (data.paymentMethod.type === PaymentMethodType.MEMBERSHIP) {
            if (!data.paymentMethod.monthly || !data.paymentMethod.sixMonths || !data.paymentMethod.yearly) {
                throw new HttpsError('invalid-argument', 'Tüm üyelik planları tanımlanmalıdır.');
            }
            // Validate monthly plan
            if (!data.paymentMethod.monthly.name || !data.paymentMethod.monthly.monthlyPrice) {
                throw new HttpsError('invalid-argument', 'Aylık üyelik bilgileri eksik.');
            }
            if (!data.paymentMethod.monthly.durationMonths) {
                data.paymentMethod.monthly.durationMonths = 1;
            }
            if (!data.paymentMethod.monthly.totalPrice) {
                data.paymentMethod.monthly.totalPrice = data.paymentMethod.monthly.monthlyPrice * data.paymentMethod.monthly.durationMonths;
            }

            // Validate 6-month plan
            if (!data.paymentMethod.sixMonths.name || !data.paymentMethod.sixMonths.monthlyPrice) {
                throw new HttpsError('invalid-argument', '6 aylık üyelik bilgileri eksik.');
            }
            if (!data.paymentMethod.sixMonths.durationMonths) {
                data.paymentMethod.sixMonths.durationMonths = 6;
            }
            if (!data.paymentMethod.sixMonths.totalPrice) {
                data.paymentMethod.sixMonths.totalPrice = data.paymentMethod.sixMonths.monthlyPrice * data.paymentMethod.sixMonths.durationMonths;
            }

            // Validate yearly plan
            if (!data.paymentMethod.yearly.name || !data.paymentMethod.yearly.monthlyPrice) {
                throw new HttpsError('invalid-argument', 'Yıllık üyelik bilgileri eksik.');
            }
            if (!data.paymentMethod.yearly.durationMonths) {
                data.paymentMethod.yearly.durationMonths = 12;
            }
            if (!data.paymentMethod.yearly.totalPrice) {
                data.paymentMethod.yearly.totalPrice = data.paymentMethod.yearly.monthlyPrice * data.paymentMethod.yearly.durationMonths;
            }
        }
    }

    try {
        // 3. Generate unique public ID
        const publicId = uuidv4();

        // 4. Create gym document
        const gymRef = db.collection(COLLECTIONS.GYMS).doc();
        const gymId = gymRef.id;

        const newGym: Gym = {
            id: gymId,
            publicId: publicId,
            name: data.name,
            photoUrl: data.photoUrl,
            ownerId: request.auth.uid,
            gymType: data.gymType,
            amenities: data.amenities,
            address: data.address,
            phoneNumber: data.phoneNumber,
            socialMedia: data.socialMedia || [],
            createdAt: admin.firestore.Timestamp.now()
        };

        // Add paymentMethod only if provided
        if (data.paymentMethod) {
            newGym.paymentMethod = data.paymentMethod;
        }

        await gymRef.set(newGym);

        // 4. Update admin's gymIds array
        await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).update({
            gymIds: admin.firestore.FieldValue.arrayUnion(gymId),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        await logActivity({
            action: LogAction.CREATE_GYM,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: {
                id: gymId,
                type: 'gym',
                name: data.name
            },
            gymId: gymId
        });

        return {
            success: true,
            message: "Spor salonu başarıyla oluşturuldu.",
            gymId: gymId,
            publicId: publicId
        };

    } catch (error: any) {
        console.error("Gym oluşturma hatası:", error);

        await logError({
            functionName: 'createGym',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { name: data.name, gymType: data.gymType }
        });

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
