import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { UserNotification } from "../types/notification.model";
import { SendNotificationParams } from "./sendNotification";
import { getNotificationOwnerCollection } from "./getNotificationOwnerCollection";

export const persistNotification = async (
    params: SendNotificationParams
): Promise<void> => {
    try {
        const createdAt = admin.firestore.Timestamp.now();
        const writes: Array<Promise<FirebaseFirestore.WriteResult>> = [];

        for (const recipientGroup of params.recipients) {
            const ownerCollection = getNotificationOwnerCollection(recipientGroup.role);
            const uniqueIds = [...new Set(recipientGroup.ids)];

            for (const uid of uniqueIds) {
                const ref = db
                    .collection(ownerCollection)
                    .doc(uid)
                    .collection(COLLECTIONS.NOTIFICATIONS)
                    .doc();

                const notificationDoc: UserNotification = {
                    id: ref.id,
                    recipientId: uid,
                    recipientRole: recipientGroup.role,
                    title: params.notification.title,
                    body: params.notification.body,
                    type: params.data?.type ?? "general",
                    data: params.data ?? {},
                    gymId: params.gymId,
                    isRead: false,
                    createdAt
                };

                writes.push(ref.set(notificationDoc));
            }
        }

        await Promise.all(writes);
    } catch (err) {
        // Bildirim kayıt hatası ana iş akışını durdurmamalı.
        console.error("persistNotification error:", err);
    }
};
