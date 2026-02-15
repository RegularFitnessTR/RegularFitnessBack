import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { MembershipPlan, MembershipPaymentMethod } from "../types/gym.payment";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

interface UpdateMembershipPlanData {
    name?: string;
    monthlyPrice?: number;
}

interface UpdateMembershipData {
    gymId: string;
    monthly?: UpdateMembershipPlanData;
    sixMonths?: UpdateMembershipPlanData;
    yearly?: UpdateMembershipPlanData;
}

export const updateMembership = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as UpdateMembershipData;
    if (!data.gymId) {
        throw new HttpsError('invalid-argument', 'Gym ID gereklidir.');
    }

    if (!data.monthly && !data.sixMonths && !data.yearly) {
        throw new HttpsError('invalid-argument', 'En az bir üyelik planı güncellenmelidir.');
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

            if (gymData?.paymentMethod?.type !== PaymentMethodType.MEMBERSHIP) {
                throw new HttpsError('failed-precondition', 'Bu spor salonu üyelik bazlı ödeme yöntemini kullanmıyor.');
            }

            const currentPaymentMethod = gymData.paymentMethod;

            // Helper to update a single plan
            const updatePlan = (currentPlan: MembershipPlan, updates?: UpdateMembershipPlanData): MembershipPlan => {
                if (!updates) return currentPlan;

                const updatedPlan = { ...currentPlan };
                if (updates.name) updatedPlan.name = updates.name;
                if (updates.monthlyPrice !== undefined) {
                    updatedPlan.monthlyPrice = updates.monthlyPrice;
                    updatedPlan.totalPrice = updates.monthlyPrice * updatedPlan.durationMonths;
                }
                return updatedPlan;
            };

            const updatedPaymentMethod = {
                ...currentPaymentMethod,
                type: PaymentMethodType.MEMBERSHIP, // Ensure type is preserved as MEMBERSHIP
                monthly: updatePlan(currentPaymentMethod.monthly, data.monthly),
                sixMonths: updatePlan(currentPaymentMethod.sixMonths, data.sixMonths),
                yearly: updatePlan(currentPaymentMethod.yearly, data.yearly)
            } as MembershipPaymentMethod; // Cast to ensure it matches the union member

            transaction.update(gymRef, {
                'paymentMethod': updatedPaymentMethod,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        // Log kaydı
        const updatedPlans: string[] = [];
        if (data.monthly) updatedPlans.push('monthly');
        if (data.sixMonths) updatedPlans.push('sixMonths');
        if (data.yearly) updatedPlans.push('yearly');

        await logActivity({
            action: LogAction.UPDATE_MEMBERSHIP,
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
            details: { updatedPlans }
        });

        return { success: true, message: "Üyelik planları başarıyla güncellendi." };

    } catch (error: any) {
        console.error("Üyelik güncelleme hatası:", error);

        await logError({
            functionName: 'updateMembership',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Üyelik planları güncellenirken bir hata oluştu.');
    }
});
