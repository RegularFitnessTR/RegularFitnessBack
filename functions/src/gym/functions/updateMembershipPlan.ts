import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { MembershipPlan } from "../types/gym.payment";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { normalizeMembershipPlan } from "../utils/paymentValidation";



interface UpdateMembershipPlanData {
    gymId: string;
    planId: string;
    updates: Partial<Omit<MembershipPlan, 'id' | 'totalPrice'>>;
}



// Plan güncelle
export const updateMembershipPlan = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Giriş yapmalısınız.');

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as UpdateMembershipPlanData;
    if (!data.gymId || !data.planId || !data.updates) {
        throw new HttpsError('invalid-argument', 'Gym ID, plan ID ve güncellenecek alanlar zorunludur.');
    }

    try {
        const gymRef = db.collection(COLLECTIONS.GYMS).doc(data.gymId);

        await db.runTransaction(async (transaction) => {
            const gymDoc = await transaction.get(gymRef);
            if (!gymDoc.exists) throw new HttpsError('not-found', 'Spor salonu bulunamadı.');

            const gymData = gymDoc.data()!;
            if (gymData.ownerId !== request.auth!.uid && role !== 'superadmin') {
                throw new HttpsError('permission-denied', 'Bu salona erişim yetkiniz yok.');
            }
            if (gymData.paymentMethod?.type !== PaymentMethodType.MEMBERSHIP) {
                throw new HttpsError('failed-precondition', 'Bu salon üyelik bazlı ödeme kullanmıyor.');
            }

            const plans: MembershipPlan[] = gymData.paymentMethod.plans || [];
            const idx = plans.findIndex(p => p.id === data.planId);
            if (idx === -1) throw new HttpsError('not-found', 'Plan bulunamadı.');

            const current = plans[idx];
            const updated: MembershipPlan = normalizeMembershipPlan({
                ...current,
                ...data.updates,
                id: current.id
            });

            // Baz plan kuralları
            if (updated.isBase && (!current.isBase)) {
                const alreadyHasBase = plans.some((p, i) => i !== idx && p.isBase);
                if (alreadyHasBase) throw new HttpsError('already-exists', 'Zaten bir baz plan mevcut.');
            }

            if (!updated.isBase && current.isBase) {
                const anotherBaseExists = plans.some((p, i) => i !== idx && p.isBase);
                if (!anotherBaseExists) {
                    throw new HttpsError('failed-precondition', 'Sistemde en az bir baz plan bulunmalıdır.');
                }
            }

            const duplicateName = plans.some(
                (p, i) => i !== idx && p.name.toLowerCase() === updated.name.toLowerCase()
            );
            if (duplicateName) {
                throw new HttpsError('already-exists', 'Aynı isimde başka bir üyelik planı mevcut.');
            }

            plans[idx] = updated;
            transaction.update(gymRef, {
                'paymentMethod.plans': plans,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await logActivity({
            action: LogAction.UPDATE_MEMBERSHIP,
            category: LogCategory.GYM,
            performedBy: { uid: request.auth!.uid, role: role as UserRole, name: request.auth!.token.name || role },
            targetEntity: { id: data.gymId, type: 'gym' },
            gymId: data.gymId,
            details: { action: 'update_plan', planId: data.planId }
        });

        return { success: true, message: 'Plan başarıyla güncellendi.' };

    } catch (error: any) {
        await logError({ functionName: 'updateMembershipPlan', error, userId: request.auth?.uid, userRole: role, requestData: data });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Plan güncellenirken bir hata oluştu.');
    }
});
