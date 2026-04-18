import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS, onCall, HttpsError } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { MembershipSubscription } from "../../subscription/types/subscription.model";
import { SubscriptionStatus } from "../../subscription/types/subscription.enums";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import {
    ensureMonthlyPaymentsUpToMonth,
    getElapsedMonthNumber,
} from "../../subscription/utils/membershipPayments";

// ─── Batch yardımcıları ───────────────────────────────────────────────────────

const BATCH_COMMIT_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        if (i + 499 < snapshot.docs.length) {
            await delay(BATCH_COMMIT_DELAY_MS);
        }
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
        if (i + 499 < snapshot.docs.length) {
            await delay(BATCH_COMMIT_DELAY_MS);
        }
    }
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export const deleteStudentAccount = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const { role } = request.auth.token;
    if (role !== "student") {
        throw new HttpsError("permission-denied", "Bu işlem için yetkiniz yok.");
    }

    const uid = request.auth.uid;
    const now = admin.firestore.Timestamp.now();

    try {
        const studentRef = db.collection(COLLECTIONS.STUDENTS).doc(uid);
        const studentDoc = await studentRef.get();

        if (!studentDoc.exists) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        const studentData = studentDoc.data()!;

        if (studentData.isDeleted) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        // ── BORÇ KONTROLÜ ────────────────────────────────────────────────────
        // Aktif aboneliği olan ve bakiyesi negatif (borcu olan) öğrenciler
        // hesaplarını silemez.
        if (studentData.activeSubscriptionId) {
            const subDoc = await db
                .collection(COLLECTIONS.SUBSCRIPTIONS)
                .doc(studentData.activeSubscriptionId)
                .get();

            if (subDoc.exists) {
                const sub = subDoc.data()!;
                if ((sub.currentBalance ?? 0) < 0) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Hesabınızda ödenmemiş borcunuz bulunmaktadır. Lütfen önce hocanızdan " +
                        "ödeme sözleşmesini iptal etmesini isteyin veya mevcut borcunuzu ödediğinizden " +
                        "emin olun. Taahhütlü bir pakete sahipseniz hocanız veya salonunuz tarafından " +
                        "tarafınıza ek ücretler yansıtılabilir."
                    );
                }
            }
        }

        // ── AŞAMA 1: GYM CHECK-OUT ───────────────────────────────────────────
        // Salon içindeyse önce çıkış yaptır.
        if (studentData.isInGym) {
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
                batch.update(studentRef, { isInGym: false });
                await batch.commit();
            }
        }

        // ── AŞAMA 2: AKTİF ABONELİĞİ İPTAL ET ──────────────────────────────
        // Abonelik varsa iptal et; taahhüt borcu varsa subscription'a kaydet.
        if (studentData.activeSubscriptionId) {
            const subRef = db
                .collection(COLLECTIONS.SUBSCRIPTIONS)
                .doc(studentData.activeSubscriptionId);

            let subType = "";

            await db.runTransaction(async (transaction) => {
                const subDoc = await transaction.get(subRef);
                if (!subDoc.exists) return;

                const sub = subDoc.data()! as any;
                if (sub.status !== SubscriptionStatus.ACTIVE) return;

                subType = sub.type;

                const updatePayload: Record<string, any> = {
                    status: SubscriptionStatus.EXPIRED,
                    cancelledAt: now,
                    cancellationReason: "account_deleted",
                    updatedAt: now,
                };

                if (sub.type === PaymentMethodType.MEMBERSHIP) {
                    const membershipSub = sub as MembershipSubscription;
                    const elapsedMonths = getElapsedMonthNumber(membershipSub.startDate, now);
                    const monthlyPayments = ensureMonthlyPaymentsUpToMonth(
                        membershipSub,
                        elapsedMonths
                    );

                    const pendingElapsedDebt = monthlyPayments
                        .filter((p) => p.status === "pending" && p.month <= elapsedMonths)
                        .reduce((sum, p) => sum + p.amount, 0);

                    let discountPaybackDebt = 0;
                    if (membershipSub.hasCommitment && membershipSub.isCommitmentActive) {
                        const consumedMonths = Math.min(elapsedMonths, membershipSub.totalMonths);
                        const monthlyDiscount = Math.max(
                            membershipSub.baseMonthlyPrice - membershipSub.monthlyPrice,
                            0
                        );
                        discountPaybackDebt = consumedMonths * monthlyDiscount;
                    }

                    const cancellationDebt = pendingElapsedDebt + discountPaybackDebt;
                    if (cancellationDebt > 0) {
                        updatePayload.cancellationDebt = cancellationDebt;
                        updatePayload.currentBalance =
                            (sub.currentBalance || 0) - cancellationDebt;
                    }
                    updatePayload.monthlyPayments = monthlyPayments;
                }

                transaction.update(subRef, updatePayload);
                transaction.update(studentRef, {
                    activeSubscriptionId: null,
                    updatedAt: now,
                });
            });

            // Paket aboneliği: bekleyen/ertelenen randevuları sil
            if (subType === PaymentMethodType.PACKAGE) {
                await deleteBatchQuery(
                    db
                        .collection(COLLECTIONS.APPOINTMENTS)
                        .where("subscriptionId", "==", studentData.activeSubscriptionId)
                        .where("status", "in", ["pending", "postponed"])
                );
            }
        }

        // ── AŞAMA 3: KALAN BEKLEYEN RANDEVULARI İPTAL ET ────────────────────
        await updateBatchQuery(
            db
                .collection(COLLECTIONS.APPOINTMENTS)
                .where("studentId", "==", uid)
                .where("status", "in", ["pending", "postponed"]),
            {
                status: "cancelled",
                cancelledAt: now,
                cancellationReason: "account_deleted",
                updatedAt: now,
            }
        );

        // ── AŞAMA 4: KİŞİSEL VERİLERİ SİL ──────────────────────────────────
        // Sağlık verileri (KVKK gereği), bildirimler, sistem olayları,
        // salon geçmişi ve bekleyen ödeme talepleri tamamen siliniyor.
        await Promise.all([
            deleteBatchQuery(
                db.collection(COLLECTIONS.MEASUREMENTS).where("studentId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.PARQ_TESTS).where("studentId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.WORKOUT_SCHEDULES).where("studentId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.NOTIFICATIONS).where("recipientId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.SYSTEM_EVENTS).where("targetUserId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.GYM_PRESENCE).where("userId", "==", uid)
            ),
            // Bekleyen ödeme talepleri silinir; onaylanmış/reddedilenler
            // finansal kayıt olarak tutulur.
            deleteBatchQuery(
                db
                    .collection(COLLECTIONS.PAYMENT_REQUESTS)
                    .where("studentId", "==", uid)
                    .where("status", "==", "pending")
            ),
        ]);

        // ── AŞAMA 5: ÖĞRENCİ DOKÜMANINI ANONİMLEŞTİR ───────────────────────
        // Abonelik ve ödeme kayıtları studentId referansına ihtiyaç duyduğundan
        // doküman silinmez; tüm PII alanları temizlenir.
        await studentRef.update({
            isDeleted: true,
            deletedAt: now,
            email: `deleted_${uid}@deleted.com`,
            firstName: "Silindi",
            lastName: "",
            phoneNumber: null,
            photoUrl: null,
            birthDate: admin.firestore.FieldValue.delete(),
            gender: admin.firestore.FieldValue.delete(),
            medicalConditions: admin.firestore.FieldValue.delete(),
            activeSubscriptionId: null,
            // gymId ve coachId boşaltılır; böylece bu belge artık
            // whereField("gymId",...) veya whereField("coachId",...) sorgularından dönmez.
            gymId: "",
            coachId: "",
            pendingPaymentCount: 0,
            isInGym: false,
            updatedAt: now,
        });

        // ── AŞAMA 6: FİREBASE AUTH KULLANICISINI SİL ────────────────────────
        await auth.deleteUser(uid);

        // ── AŞAMA 7: AKTİVİTE LOGU ──────────────────────────────────────────
        await logActivity({
            action: LogAction.DELETE_STUDENT,
            category: LogCategory.STUDENT,
            performedBy: {
                uid,
                role: "student",
                name: `${studentData.firstName} ${studentData.lastName}`,
            },
            targetEntity: {
                id: uid,
                type: "student",
                name: `${studentData.firstName} ${studentData.lastName}`,
            },
            gymId: studentData.gymId || undefined,
            details: { selfDeletion: true },
        });

        return { success: true, message: "Hesabınız başarıyla silindi." };

    } catch (error: any) {
        void logError({
            functionName: "deleteStudentAccount",
            error,
            userId: uid,
            userRole: "student",
            requestData: {},
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Hesap silinirken bir hata oluştu.");
    }
});
