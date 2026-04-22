import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { syncGymClaims } from "../../common/utils/syncGymClaims";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const coachJoinGym = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const { role } = request.auth.token;
    if (role !== "coach") {
        throw new HttpsError("permission-denied", "Bu işlem sadece hocalar tarafından yapılabilir.");
    }

    const coachUid = request.auth.uid;
    const { gymPublicId } = request.data as { gymPublicId: string };

    if (!gymPublicId) {
        throw new HttpsError("invalid-argument", "Salon kodu bilgisi eksik.");
    }

    try {
        const coachDoc = await db.collection(COLLECTIONS.COACHES).doc(coachUid).get();

        if (!coachDoc.exists) {
            throw new HttpsError("not-found", "Hoca kaydı bulunamadı.");
        }

        const coachData = coachDoc.data()!;

        if (coachData.gymId) {
            throw new HttpsError(
                "already-exists",
                "Zaten bir salona kayıtlısınız. Önce mevcut salondan ayrılmanız gerekmektedir."
            );
        }

        // Salonu publicId ile bul
        const gymSnapshot = await db
            .collection(COLLECTIONS.GYMS)
            .where("publicId", "==", gymPublicId)
            .limit(1)
            .get();

        if (gymSnapshot.empty) {
            throw new HttpsError(
                "not-found",
                "Belirtilen salon kodu bulunamadı. Lütfen kodu kontrol ediniz."
            );
        }

        const gymDoc = gymSnapshot.docs[0];
        const gymData = gymDoc.data();

        await db.collection(COLLECTIONS.COACHES).doc(coachUid).update({
            gymId: gymDoc.id,
            updatedAt: admin.firestore.Timestamp.now(),
        });

        // Custom claims'e gymId ekle
        await syncGymClaims(coachUid, { gymId: gymDoc.id });

        void logActivity({
            action: LogAction.COACH_JOIN_GYM,
            category: LogCategory.COACH,
            performedBy: {
                uid: coachUid,
                role: "coach",
                name: `${coachData.firstName} ${coachData.lastName}`,
            },
            targetEntity: {
                id: gymDoc.id,
                type: "gym",
                name: gymData.name,
            },
            gymId: gymDoc.id,
        });

        return {
            success: true,
            message: "Salona başarıyla katıldınız.",
            gymName: gymData.name,
        };

    } catch (error: any) {
        void logError({
            functionName: "coachJoinGym",
            error,
            userId: coachUid,
            userRole: "coach",
            requestData: { gymPublicId },
        });

        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Salon kaydı sırasında bir hata oluştu.");
    }
});
