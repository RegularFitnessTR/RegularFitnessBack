import * as admin from "firebase-admin";
import { db, COLLECTIONS, syncGymClaims, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const deleteGym = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Admin mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için admin yetkisi gereklidir.');
    }

    const { gymId } = request.data;

    if (!gymId) {
        throw new HttpsError(
            'invalid-argument',
            'Gym ID belirtilmesi zorunludur.'
        );
    }

    try {
        // 2. Verify gym exists and admin owns it
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();

        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }

        const gymData = gymDoc.data();

        // Verify ownership (either owner or superadmin)
        if (gymData?.ownerId !== request.auth.uid && role !== 'superadmin') {
            throw new HttpsError(
                'permission-denied',
                'Bu spor salonunu silme yetkiniz yok.'
            );
        }

        const now = admin.firestore.Timestamp.now();

        // 3. Bu salona bağlı tüm coach, öğrenci ve abonelik referanslarını temizle
        const [coachesSnap, studentsSnap, activeSubsSnap, pendingApptsSnap] = await Promise.all([
            db.collection(COLLECTIONS.COACHES).where('gymId', '==', gymId).get(),
            db.collection(COLLECTIONS.STUDENTS).where('gymId', '==', gymId).get(),
            db.collection(COLLECTIONS.SUBSCRIPTIONS).where('gymId', '==', gymId)
                .where('status', '==', 'active').get(),
            db.collection(COLLECTIONS.APPOINTMENTS).where('gymId', '==', gymId)
                .where('status', 'in', ['pending', 'postponed']).get(),
        ]);

        // 4. Delete gym document + admin gymIds güncelle (ilk batch — 2 slot)
        const batch = db.batch();
        batch.delete(db.collection(COLLECTIONS.GYMS).doc(gymId));
        batch.update(db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid), {
            gymIds: admin.firestore.FieldValue.arrayRemove(gymId),
            updatedAt: now
        });

        // İlişkili dokümanları topla
        type BatchOp = (b: FirebaseFirestore.WriteBatch) => void;
        const ops: BatchOp[] = [];

        coachesSnap.forEach(doc => ops.push(b =>
            b.update(doc.ref, { gymId: '', updatedAt: now })
        ));
        studentsSnap.forEach(doc => ops.push(b =>
            b.update(doc.ref, { gymId: '', coachId: '', activeSubscriptionId: null, updatedAt: now })
        ));
        activeSubsSnap.forEach(doc => ops.push(b =>
            b.update(doc.ref, { status: 'expired', cancelledAt: now,
                cancellationReason: 'gym_deleted', updatedAt: now })
        ));
        pendingApptsSnap.forEach(doc => ops.push(b => b.delete(doc.ref)));

        // İlk batch'e kalan 497 slot'u doldur
        ops.slice(0, 497).forEach(fn => fn(batch));
        await batch.commit();

        // Kalan op'ları 499'luk batch'ler halinde işle
        for (let i = 497; i < ops.length; i += 499) {
            const extraBatch = db.batch();
            ops.slice(i, i + 499).forEach(fn => fn(extraBatch));
            await extraBatch.commit();
        }

        // Gym silinen admin ve coach'ların custom claims'lerini güncelle
        const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
        const updatedGymIds: string[] = adminDoc.data()?.gymIds || [];
        await syncGymClaims(request.auth.uid, { gymIds: updatedGymIds });

        const coachClaimsUpdates = coachesSnap.docs.map(doc =>
            syncGymClaims(doc.id, { gymId: '' })
        );
        await Promise.all(coachClaimsUpdates);

        // Log kaydı
        await logActivity({
            action: LogAction.DELETE_GYM,
            category: LogCategory.GYM,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role
            },
            targetEntity: {
                id: gymId,
                type: 'gym',
                name: gymData?.name
            },
            gymId: gymId
        });

        return {
            success: true,
            message: "Spor salonu başarıyla silindi."
        };

    } catch (error: any) {
        console.error("Gym silme hatası:", error);

        await logError({
            functionName: 'deleteGym',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { gymId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
