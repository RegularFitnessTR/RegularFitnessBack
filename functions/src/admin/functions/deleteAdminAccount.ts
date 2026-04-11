import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

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

type BatchOp = (b: FirebaseFirestore.WriteBatch) => void;

async function commitOps(ops: BatchOp[]): Promise<void> {
    for (let i = 0; i < ops.length; i += 499) {
        const batch = db.batch();
        ops.slice(i, i + 499).forEach((fn) => fn(batch));
        await batch.commit();
    }
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export const deleteAdminAccount = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const { role } = request.auth.token;
    if (role !== "admin") {
        throw new HttpsError("permission-denied", "Bu işlem için yetkiniz yok.");
    }

    const uid = request.auth.uid;
    const now = admin.firestore.Timestamp.now();

    try {
        const adminRef = db.collection(COLLECTIONS.ADMINS).doc(uid);
        const adminDoc = await adminRef.get();

        if (!adminDoc.exists) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        const adminData = adminDoc.data()!;

        if (adminData.isDeleted) {
            throw new HttpsError("not-found", "Hesap bulunamadı.");
        }

        // ── AŞAMA 1: ADMİN'E AİT TÜM GYM'LERİ İŞLE ─────────────────────────
        // Her gym için cascading cleanup yapılır.
        // Gym'ler sıralı olarak işlenir (Firestore batch limitlerini aşmamak için).
        const gymsSnap = await db
            .collection(COLLECTIONS.GYMS)
            .where("ownerId", "==", uid)
            .get();

        for (const gymDoc of gymsSnap.docs) {
            const gymId = gymDoc.id;

            // Gym'e bağlı tüm verileri paralel olarak çek
            const [
                coachesSnap,
                studentsSnap,
                activeSubsSnap,
                pendingApptsSnap,
            ] = await Promise.all([
                db.collection(COLLECTIONS.COACHES)
                    .where("gymId", "==", gymId)
                    .get(),
                db.collection(COLLECTIONS.STUDENTS)
                    .where("gymId", "==", gymId)
                    .get(),
                db.collection(COLLECTIONS.SUBSCRIPTIONS)
                    .where("gymId", "==", gymId)
                    .where("status", "==", "active")
                    .get(),
                db.collection(COLLECTIONS.APPOINTMENTS)
                    .where("gymId", "==", gymId)
                    .where("status", "in", ["pending", "postponed"])
                    .get(),
            ]);

            const ops: BatchOp[] = [];

            // Koçların gym ilişkisini temizle.
            // Koç hesabı aktif kalmaya devam eder, yeni bir gym'e katılabilir.
            coachesSnap.forEach((doc) =>
                ops.push((b) =>
                    b.update(doc.ref, {
                        gymId: "",
                        isInGym: false,
                        updatedAt: now,
                    })
                )
            );

            // Öğrencilerin gym, koç ve abonelik referanslarını temizle.
            // Öğrenci hesabı aktif kalmaya devam eder.
            studentsSnap.forEach((doc) =>
                ops.push((b) =>
                    b.update(doc.ref, {
                        gymId: "",
                        coachId: "",
                        activeSubscriptionId: null,
                        isInGym: false,
                        updatedAt: now,
                    })
                )
            );

            // Aktif abonelikleri sona erdir.
            // GYM KAPANIYOR → öğrenciye borç yüklenmez (cancellationDebt hesaplanmaz).
            // Finansal kayıt olarak tutulur, hard delete yapılmaz.
            activeSubsSnap.forEach((doc) =>
                ops.push((b) =>
                    b.update(doc.ref, {
                        status: "expired",
                        cancelledAt: now,
                        cancellationReason: "gym_closed",
                        updatedAt: now,
                    })
                )
            );

            // Bekleyen ve ertelenen randevuları iptal et.
            // Tamamlanmış randevular tarihsel kayıt olarak korunur.
            pendingApptsSnap.forEach((doc) =>
                ops.push((b) =>
                    b.update(doc.ref, {
                        status: "cancelled",
                        cancelledAt: now,
                        cancellationReason: "gym_closed",
                        updatedAt: now,
                    })
                )
            );

            // Gym dokümanını sil
            ops.push((b) => b.delete(gymDoc.ref));

            await commitOps(ops);

            // Gym'e bağlı kişisel olmayan veriler: bildirimler, sistem olayları,
            // salon geçişleri (gymId bazlı sorgular) paralel olarak silinir.
            // İşlenmemiş ödeme talepleri de silinir; onaylananlar finansal
            // kayıt olarak zaten tutulmaktadır.
            await Promise.all([
                deleteBatchQuery(
                    db.collection(COLLECTIONS.NOTIFICATIONS)
                        .where("gymId", "==", gymId)
                ),
                deleteBatchQuery(
                    db.collection(COLLECTIONS.SYSTEM_EVENTS)
                        .where("gymId", "==", gymId)
                ),
                deleteBatchQuery(
                    db.collection(COLLECTIONS.GYM_PRESENCE)
                        .where("gymId", "==", gymId)
                ),
                deleteBatchQuery(
                    db.collection(COLLECTIONS.PAYMENT_REQUESTS)
                        .where("gymId", "==", gymId)
                        .where("status", "==", "pending")
                ),
            ]);
        }

        // ── AŞAMA 2: ADMİN'İN KİŞİSEL VERİLERİNİ SİL ───────────────────────
        // Gym'lere bağlı olmayanlar dahil adminin tüm bildirimleri,
        // sistem olayları ve salon geçiş kayıtları silinir.
        await Promise.all([
            deleteBatchQuery(
                db.collection(COLLECTIONS.NOTIFICATIONS)
                    .where("recipientId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.SYSTEM_EVENTS)
                    .where("targetUserId", "==", uid)
            ),
            deleteBatchQuery(
                db.collection(COLLECTIONS.GYM_PRESENCE)
                    .where("userId", "==", uid)
            ),
        ]);

        // ── AŞAMA 3: ADMİN DOKÜMANINI ANONİMLEŞTİR ──────────────────────────
        // subscriptions.assignedBy ve paymentRequests.processedBy gibi alanlardaki
        // referansların bozulmaması için doküman hard delete yapılmaz.
        // Tüm PII alanları temizlenir, activityLogs denetim izi için korunur.
        await adminRef.update({
            isDeleted: true,
            deletedAt: now,
            email: `deleted_${uid}@deleted.com`,
            firstName: "Silindi",
            lastName: "",
            phoneNumber: null,
            photoUrl: null,
            gymIds: [],
            updatedAt: now,
        });

        // ── AŞAMA 4: FİREBASE AUTH KULLANICISINI SİL ─────────────────────────
        await auth.deleteUser(uid);

        // ── AŞAMA 5: AKTİVİTE LOGU ───────────────────────────────────────────
        await logActivity({
            action: LogAction.DELETE_ADMIN_ACCOUNT,
            category: LogCategory.ADMIN,
            performedBy: {
                uid,
                role: "admin",
                name: `${adminData.firstName} ${adminData.lastName}`,
            },
            targetEntity: {
                id: uid,
                type: "admin",
                name: `${adminData.firstName} ${adminData.lastName}`,
            },
            details: {
                selfDeletion: true,
                gymCount: gymsSnap.size,
            },
        });

        return { success: true, message: "Hesabınız başarıyla silindi." };

    } catch (error: any) {
        await logError({
            functionName: "deleteAdminAccount",
            error,
            userId: uid,
            userRole: "admin",
            requestData: {},
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Hesap silinirken bir hata oluştu.");
    }
});
