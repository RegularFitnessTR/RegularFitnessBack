import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";
import { LogSeverity } from "../../log/types/log.enums";
import { UserNotification } from "../types/notification.model";
import { SendNotificationParams } from "./sendNotification";
import { getNotificationOwnerCollection } from "./getNotificationOwnerCollection";

/** uid → notificationId eşlemesi döner, sendAndStoreNotification bunu FCM'e ekler */
export const persistNotification = async (
    params: SendNotificationParams
): Promise<Map<string, string>> => {
    const uidToNotificationId = new Map<string, string>();

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

                uidToNotificationId.set(uid, ref.id);

                const notificationDoc: UserNotification = {
                    id: ref.id,
                    recipientId: uid,
                    recipientRole: recipientGroup.role,
                    title: params.notification.title,
                    body: params.notification.body,
                    type: params.data?.type ?? "general",
                    data: { ...(params.data ?? {}), notificationId: ref.id },
                    isRead: false,
                    createdAt,
                    ...(params.gymId ? { gymId: params.gymId } : {})
                };

                writes.push(ref.set(notificationDoc));
            }
        }

        await Promise.all(writes);
    } catch (err) {
        console.error("persistNotification error:", err);

        const totalRecipients = params.recipients.reduce(
            (sum, group) => sum + group.ids.length,
            0
        );

        await logError({
            functionName: "persistNotification",
            error: err,
            severity: LogSeverity.ERROR,
            requestData: {
                recipientGroupCount: params.recipients.length,
                totalRecipients,
                notificationType: params.data?.type ?? "general",
            },
        });
    }

    return uidToNotificationId;
};
