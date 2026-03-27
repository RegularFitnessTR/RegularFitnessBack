import { persistNotification } from "./persistNotification";
import { sendNotification, SendNotificationParams } from "./sendNotification";

export const sendAndStoreNotification = async (
    params: SendNotificationParams
): Promise<void> => {
    await Promise.all([
        sendNotification(params),
        persistNotification(params)
    ]);
};
