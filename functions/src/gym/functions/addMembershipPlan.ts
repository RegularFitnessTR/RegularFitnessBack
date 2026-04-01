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

interface AddMembershipPlanData {
    gymId: string;
    plan: Omit<MembershipPlan, 'id' | 'totalPrice'>;
}



export const addMembershipPlan = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Giriş yapmalısınız.');

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as AddMembershipPlanData;
    if (!data.gymId || !data.plan) {
        throw new HttpsError('invalid-argument', 'Gym ID ve plan bilgileri zorunludur.');
    }

    const { plan } = data;
    const normalizedPlan = normalizeMembershipPlan(plan as MembershipPlan);

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

            const existingPlans: MembershipPlan[] = gymData.paymentMethod.plans || [];

            // isBase true gönderildiyse, mevcut baz planı koru — sadece 1 baz plan olabilir
            if (normalizedPlan.isBase) {
                const alreadyHasBase = existingPlans.some(p => p.isBase);
                if (alreadyHasBase) {
                    throw new HttpsError('already-exists', 'Zaten bir baz plan mevcut. Önce mevcut baz planı güncelleyin.');
                }
            }

            const duplicateName = existingPlans.some(
                p => p.name.toLowerCase() === normalizedPlan.name.toLowerCase()
            );
            if (duplicateName) {
                throw new HttpsError('already-exists', 'Aynı isimde üyelik planı zaten mevcut.');
            }

            transaction.update(gymRef, {
                'paymentMethod.plans': admin.firestore.FieldValue.arrayUnion(normalizedPlan),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await logActivity({
            action: LogAction.UPDATE_MEMBERSHIP,
            category: LogCategory.GYM,
            performedBy: { uid: request.auth!.uid, role: role as UserRole, name: request.auth!.token.name || role },
            targetEntity: { id: data.gymId, type: 'gym' },
            gymId: data.gymId,
            details: { action: 'add_plan', planName: normalizedPlan.name }
        });

        return { success: true, message: 'Plan başarıyla eklendi.' };

    } catch (error: any) {
        await logError({ functionName: 'addMembershipPlan', error, userId: request.auth?.uid, userRole: role, requestData: data });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Plan eklenirken bir hata oluştu.');
    }
});