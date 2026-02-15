import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { RemoveAmenityData } from "../types/gym.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const deleteAmenity = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as RemoveAmenityData;

    if (!data.gymId || !data.amenities || data.amenities.length === 0) {
        throw new HttpsError('invalid-argument', 'Salon ID ve en az bir imkan bilgisi zorunludur.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);
        const gymDoc = await gymRef.get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Salon bulunamadı.');
        }

        // Check if user is owner or admin
        const gymData = gymDoc.data() as any;
        if (gymData.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError('permission-denied', 'Bu salonu düzenleme yetkiniz yok.');
        }

        await gymRef.update({
            amenities: admin.firestore.FieldValue.arrayRemove(...data.amenities),
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Log kaydı
        await logActivity({
            action: LogAction.DELETE_AMENITY,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: data.gymId,
                type: 'gym',
                name: gymData.name
            },
            gymId: data.gymId,
            details: { amenities: data.amenities }
        });

        return {
            success: true,
            message: "İmkan başarıyla silindi.",
            data: data.amenities
        };

    } catch (error: any) {
        console.error("İmkan silme hatası:", error);

        await logError({
            functionName: 'deleteAmenity',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error.code === 'permission-denied' || error.code === 'not-found') {
            throw error;
        }
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});