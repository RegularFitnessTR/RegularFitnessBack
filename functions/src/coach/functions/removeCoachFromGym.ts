import * as admin from "firebase-admin";
import { db, COLLECTIONS, syncGymClaims, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";
import { SubscriptionStatus } from "../../subscription/types/subscription.enums";

// ─── Batch yardımcıları ───────────────────────────────────────────────────────

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

export const removeCoachFromGym = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const { role } = request.auth.token;
    if (role !== "admin" && role !== "superadmin") {
        throw new HttpsError("permission-denied", "Bu işlem için yetkiniz yok.");
    }

    const { coachUid } = request.data as { coachUid: string };
    if (!coachUid) {
        throw new HttpsError("invalid-argument", "Hoca UID zorunludur.");
    }

    try {
        // Hoca dokümanını yükle
        const coachRef = db.collection(COLLECTIONS.COACHES).doc(coachUid);
        const coachDoc = await coachRef.get();

        if (!coachDoc.exists) {
            throw new HttpsError("not-found", "Hoca bulunamadı.");
        }

        const coachData = coachDoc.data()!;

        if (!coachData.gymId) {
            throw new HttpsError(
                "failed-precondition",
                "Bu hoca zaten herhangi bir salona bağlı değil."
            );
        }

        const gymId = coachData.gymId as string;

        // Admin kendi salonunu yönetip yönetmediğini doğrula (custom claims'den)
        if (role === "admin") {
            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError(
                    "permission-denied",
                    "Bu hoca sizin yönettiğiniz bir salona bağlı değil."
                );
            }
        }

        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        const gymName = gymDoc.exists ? gymDoc.data()?.name || "" : "";
        const now = admin.firestore.Timestamp.now();

        // ── AŞAMA 1: SALON İÇİNDEYSE CHECK-OUT YAP ──────────────────────────
        if (coachData.isInGym) {
            const presenceSnapshot = await db
                .collection(COLLECTIONS.GYM_PRESENCE)
                .where("userId", "==", coachUid)
                .where("gymId", "==", gymId)
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

        // ── AŞAMA 2: ÖĞRENCİLERİN HOCA ATAMASINI TEMİZLE ────────────────────
        // Bu salondan bu hocaya bağlı öğrencilerin coachId alanı boşaltılır.
        // Öğrenciler salondan ayrılmaz, abonelikleri devam eder.
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.STUDENTS)
                .where("coachId", "==", coachUid)
                .where("gymId", "==", gymId),
            { coachId: "", updatedAt: now }
        );

        // ── AŞAMA 3: AKTİF ABONELİKLERDEKİ HOCA REFERANSINI TEMİZLE ─────────
        // Abonelikler ve finansal kayıtlar bütündür; sadece coachId boşaltılır.
        // Ödeme talepleri (pending dahil) gym admini tarafından işlenmeye devam eder.
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.SUBSCRIPTIONS)
                .where("coachId", "==", coachUid)
                .where("gymId", "==", gymId)
                .where("status", "==", SubscriptionStatus.ACTIVE),
            { coachId: "", updatedAt: now }
        );

        // ── AŞAMA 4: BEKLEYEN / ERTELENMİŞ RANDEVULARI İPTAL ET ─────────────
        // Tamamlanmış randevular tarihsel kayıt olarak korunur.
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.APPOINTMENTS)
                .where("coachId", "==", coachUid)
                .where("gymId", "==", gymId)
                .where("status", "in", ["pending", "postponed"]),
            {
                status: "cancelled",
                cancelledAt: now,
                cancellationReason: "coach_removed_from_gym",
                updatedAt: now,
            }
        );

        // ── AŞAMA 5: HOCANIN GYM REFERANSINI TEMİZLE ─────────────────────────
        // Hoca hesabı sistemde kalmaya devam eder; başka bir salona katılabilir.
        await coachRef.update({
            gymId: "",
            updatedAt: now,
        });

        // Custom claims'den gymId'yi temizle
        await syncGymClaims(coachUid, { gymId: '' });

        await logActivity({
            action: LogAction.REMOVE_COACH_FROM_GYM,
            category: LogCategory.COACH,
            performedBy: {
                uid: request.auth.uid,
                role: role as UserRole,
                name: request.auth.token.name || role,
            },
            targetEntity: {
                id: coachUid,
                type: "coach",
                name: `${coachData.firstName} ${coachData.lastName}`,
            },
            gymId,
            details: { gymName, coachName: `${coachData.firstName} ${coachData.lastName}` },
        });

        return {
            success: true,
            message: "Hocanın salon ilişiği başarıyla kesildi.",
        };

    } catch (error: any) {
        void logError({
            functionName: "removeCoachFromGym",
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { coachUid },
        });

        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "İşlem sırasında bir hata oluştu.");
    }
});
