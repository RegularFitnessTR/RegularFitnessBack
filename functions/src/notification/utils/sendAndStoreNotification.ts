import { persistNotification } from "./persistNotification";
import { sendNotification, SendNotificationParams } from "./sendNotification";

export const sendAndStoreNotification = async (
    params: SendNotificationParams
): Promise<void> => {
    // 1. Firestore'a yaz, uid → notificationId map'ini al
    const uidToNotificationId = await persistNotification(params);

    // 2. uid → { notificationId } şeklinde data map'i oluştur
    const uidToData = new Map<string, Record<string, string>>();
    uidToNotificationId.forEach((notificationId, uid) => {
        uidToData.set(uid, { notificationId });
    });

    // 3. Tek seferde, 500'lük batch'ler halinde FCM'e gönder
    await sendNotification(params, uidToData);
};
