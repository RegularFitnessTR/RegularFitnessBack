import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { UserRole } from "../../common/types/base";
import { logError } from "../../log/utils/logError";
import { GetMyNotificationsData } from "../types/notification.dto";
import { getNotificationOwnerCollection } from "../utils/getNotificationOwnerCollection";

export const getMyNotifications = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const role = request.auth.token.role as UserRole;
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as GetMyNotificationsData;

    try {
        const ownerCollection = getNotificationOwnerCollection(role);
        const requestedLimit = Number(data.limit ?? 30);
        const limit = Number.isNaN(requestedLimit)
            ? 30
            : Math.min(Math.max(requestedLimit, 1), 100);
        const selectedGymId = data.gymId;

        if (role === "admin") {
            if (!selectedGymId) {
                throw new HttpsError("invalid-argument", "Admin için gymId zorunludur.");
            }

            const adminGymIds: string[] = request.auth.token.gymIds || [];
            if (!adminGymIds.includes(selectedGymId)) {
                throw new HttpsError("permission-denied", "Bu spor salonuna erişim yetkiniz yok.");
            }
        }

        const notificationsRef = db
            .collection(ownerCollection)
            .doc(uid)
            .collection(COLLECTIONS.NOTIFICATIONS);

        const listQuery = role === "admin"
            ? notificationsRef
                .where("gymId", "==", selectedGymId)
                .orderBy("createdAt", "desc")
                .limit(limit)
            : notificationsRef
                .orderBy("createdAt", "desc")
                .limit(limit);

        const unreadQuery = role === "admin"
            ? notificationsRef
                .where("gymId", "==", selectedGymId)
                .where("isRead", "==", false)
            : notificationsRef.where("isRead", "==", false);

        const [listSnapshot, unreadSnapshot] = await Promise.all([
            listQuery.get(),
            unreadQuery.get()
        ]);

        const notifications = listSnapshot.docs.map((doc) => serializeTimestamps(doc.data()));

        return {
            success: true,
            notifications,
            count: notifications.length,
            unreadCount: unreadSnapshot.size
        };
    } catch (error: any) {
        console.error("Bildirimleri getirme hatası:", error);

        void logError({
            functionName: "getMyNotifications",
            error,
            userId: uid,
            userRole: role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError("internal", "Bildirimler alınırken bir hata oluştu.");
    }
});
