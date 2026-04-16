import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { UserRole } from "../../common/types/base";
import { logError } from "../../log/utils/logError";
import { MarkNotificationAsReadData } from "../types/notification.dto";
import { getNotificationOwnerCollection } from "../utils/getNotificationOwnerCollection";

export const markNotificationAsRead = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Bu işlem için giriş yapmalısınız.");
    }

    const role = request.auth.token.role as UserRole;
    const uid = request.auth.uid;
    const data = request.data as MarkNotificationAsReadData;

    if (!data?.notificationId) {
        throw new HttpsError("invalid-argument", "Bildirim ID belirtilmesi zorunludur.");
    }

    try {
        const ownerCollection = getNotificationOwnerCollection(role);
        const notificationRef = db
            .collection(ownerCollection)
            .doc(uid)
            .collection(COLLECTIONS.NOTIFICATIONS)
            .doc(data.notificationId);

        const notificationDoc = await notificationRef.get();
        if (!notificationDoc.exists) {
            throw new HttpsError("not-found", "Bildirim bulunamadı.");
        }

        if (notificationDoc.data()?.isRead) {
            return {
                success: true,
                message: "Bildirim zaten okunmuş durumda."
            };
        }

        await notificationRef.update({
            isRead: true,
            readAt: admin.firestore.Timestamp.now()
        });

        return {
            success: true,
            message: "Bildirim okundu olarak işaretlendi."
        };
    } catch (error: any) {
        console.error("Bildirim okundu işaretleme hatası:", error);

        await logError({
            functionName: "markNotificationAsRead",
            error,
            userId: uid,
            userRole: role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError("internal", "Bildirim güncellenirken bir hata oluştu.");
    }
});
