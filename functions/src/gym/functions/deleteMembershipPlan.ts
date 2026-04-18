import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { PaymentMethodType } from "../types/gym.enums";
import { MembershipPlan } from "../types/gym.payment";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";



interface DeleteMembershipPlanData {
    gymId: string;
    planId: string;
}


// Plan sil
export const deleteMembershipPlan = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Giriş yapmalısınız.');

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const data = request.data as DeleteMembershipPlanData;
    if (!data.gymId || !data.planId) {
        throw new HttpsError('invalid-argument', 'Gym ID ve plan ID zorunludur.');
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
            const target = plans.find(p => p.id === data.planId);
            if (!target) throw new HttpsError('not-found', 'Plan bulunamadı.');
            if (target.isBase) {
                throw new HttpsError('failed-precondition', 'Baz plan silinemez. Önce başka bir planı baz plan yapın.');
            }

            const updated = plans.filter(p => p.id !== data.planId);
            transaction.update(gymRef, {
                'paymentMethod.plans': updated,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        void logActivity({
            action: LogAction.UPDATE_MEMBERSHIP,
            category: LogCategory.GYM,
            performedBy: { uid: request.auth!.uid, role: role as UserRole, name: request.auth!.token.name || role },
            targetEntity: { id: data.gymId, type: 'gym' },
            gymId: data.gymId,
            details: { action: 'delete_plan', planId: data.planId }
        });

        return { success: true, message: 'Plan başarıyla silindi.' };

    } catch (error: any) {
        void logError({ functionName: 'deleteMembershipPlan', error, userId: request.auth?.uid, userRole: role, requestData: data });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Plan silinirken bir hata oluştu.');
    }
});