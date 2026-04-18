import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { SubscriptionStatus } from "../../subscription/types/subscription.enums";

// ─── Batch yardımcıları ───────────────────────────────────────────────────────

async function deleteBatchQuery(
    query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>
): Promise<void> {
    const snapshot = await query.get();
    if (snapshot.empty) return;

    for (let i = 0; i < snapshot.docs.length; i += 499) {
        const chunk = snapshot.docs.slice(i, i + 499);
        const batch = db.batch();
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }
}

async function updateBatchQuery(
    query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
    data: Record<string, any>
): Promise<void> {
    const snapshot = await query.get();
    if (snapshot.empty) return;

    for (let i = 0; i < snapshot.docs.length; i += 499) {
        const chunk = snapshot.docs.slice(i, i + 499);
        const batch = db.batch();
        chunk.forEach((doc) => batch.update(doc.ref, data));
        await batch.commit();
    }
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export const deleteCoachAccount = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const { role } = request.auth.token;
    if (role !== "coach") {
        throw new HttpsError("permission-denied", "Bu işlem için yetkiniz yok.");
    }

    const uid = request.auth.uid;
    const now = admin.firestore.Timestamp.now();

    try {
        const coachRef = db.collection(COLLECTIONS.COACHES).doc(uid);
        const coachDoc = await coachRef.get();

        if (!coachDoc.exists) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        const coachData = coachDoc.data()!;

        if (coachData.isDeleted) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        // ── AŞAMA 1: GYM CHECK-OUT ───────────────────────────────────────────
        if (coachData.isInGym) {
            const presenceSnapshot = await db
                .collection(COLLECTIONS.GYM_PRESENCE)
                .where("userId", "==", uid)
                .where("isActive", "==", true)
                .limit(1)
                .get();

            if (!presenceSnapshot.empty) {
                const batch = db.batch();
                batch.update(presenceSnapshot.docs[0].ref, {
                    isActive: false,
                    checkedOutAt: now,
                });
                batch.update(coachRef, { isInGym: false });
                await batch.commit();
            }
        }

        // ── AŞAMA 2: ÖĞRENCİ İLİŞKİLERİNİ TEMİZLE ──────────────────────────
        // Bu hocaya bağlı öğrencilerin coachId alanı boşaltılır.
        // Öğrenciler sistemde kalmaya devam eder; yeni hoca atayabilirler.
        await updateBatchQuery(
            db.collection(COLLECTIONS.STUDENTS).where("coachId", "==", uid),
            { coachId: "", updatedAt: now }
        );

        // ── AŞAMA 3: AKTİF ABONELİKLERDEKİ HOCA REFERANSINI TEMİZLE ────────
        // Abonelikler öğrenciler için geçerliliğini korur; finansal kayıtlar
        // bütündür. Sadece coachId referansı boşaltılır ki sistem hata vermesin.
        // Onaylanmamış ödeme talepleri (pending) gym admini tarafından
        // işlenebileceğinden dokunulmaz.
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.SUBSCRIPTIONS)
                .where("coachId", "==", uid)
                .where("status", "==", SubscriptionStatus.ACTIVE),
            { coachId: "", updatedAt: now }
        );

        // ── AŞAMA 4: BEKLEYEN / ERTELENMİŞ RANDEVULARI İPTAL ET ─────────────
        // Tamamlanmış randevular tarihsel kayıt olarak tutulur.
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.APPOINTMENTS)
                .where("coachId", "==", uid)
                .where("status", "in", ["pending", "postponed"]),
            {
                status: "cancelled",
                cancelledAt: now,
                cancellationReason: "coach_account_deleted",
                updatedAt: now,
            }
        );

        // ── AŞAMA 5: HOCANIN KİŞİSEL VERİLERİNİ SİL ────────────────────────
        await Promise.all([
            deleteBatchQuery(
                db.collection(COLLECTIONS.NOTIFICATIONS).where("recipientId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.SYSTEM_EVENTS).where("targetUserId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.GYM_PRESENCE).where("userId", "==", uid)
            ),
        ]);

        // ── AŞAMA 6: HOCA DOKÜMANINI ANONİMLEŞTİR ───────────────────────────
        // Tamamlanmış randevulardaki coachId referansının çözümlenebilmesi için
        // doküman silinmez; tüm PII alanları temizlenir.
        await coachRef.update({
            isDeleted: true,
            deletedAt: now,
            email: `deleted_${uid}@deleted.com`,
            firstName: "Silindi",
            lastName: "",
            phoneNumber: null,
            photoUrl: null,
            expertise: admin.firestore.FieldValue.delete(),
            experienceYears: admin.firestore.FieldValue.delete(),
            qrCodeString: admin.firestore.FieldValue.delete(),
            gymId: admin.firestore.FieldValue.delete(),
            isInGym: false,
            updatedAt: now,
        });

        // ── AŞAMA 7: FİREBASE AUTH KULLANICISINI SİL ────────────────────────
        await auth.deleteUser(uid);

        // ── AŞAMA 8: AKTİVİTE LOGU ──────────────────────────────────────────
        void logActivity({
            action: LogAction.DELETE_COACH_ACCOUNT,
            category: LogCategory.COACH,
            performedBy: {
                uid,
                role: "coach",
                name: `${coachData.firstName} ${coachData.lastName}`,
            },
            targetEntity: {
                id: uid,
                type: "coach",
                name: `${coachData.firstName} ${coachData.lastName}`,
            },
            gymId: coachData.gymId || undefined,
            details: { selfDeletion: true },
        });

        return { success: true, message: "Hesabınız başarıyla silindi." };

    } catch (error: any) {
        void logError({
            functionName: "deleteCoachAccount",
            error,
            userId: uid,
            userRole: "coach",
            requestData: {},
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Hesap silinirken bir hata oluştu.");
    }
});
