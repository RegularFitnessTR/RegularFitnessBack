// notifications/utils/sendNotification.ts

import * as admin from "firebase-admin";
import { UserRole } from "../../common/types/base";
import { getTokensByRole } from "./getTokensByRole";
import { cleanStaleTokens } from "./cleanStaleTokens";

export interface NotificationRecipient {
    ids: string[];
    role: UserRole;
}

export interface SendNotificationParams {
    recipients: NotificationRecipient[];
    notification: { title: string; body: string };
    data?: Record<string, string>;
    gymId?: string;
}

export const sendNotification = async (
    params: SendNotificationParams
): Promise<void> => {
    try {
        // 1. Tüm roller için token'ları paralel topla
        const entries = (
            await Promise.all(
                params.recipients.map(r => getTokensByRole(r.ids, r.role))
            )
        ).flat();

        if (entries.length === 0) return;

        const allTokens = entries.map(e => e.token);

        // 2. FCM limiti: max 500 token/istek
        const chunks: string[][] = [];
        for (let i = 0; i < allTokens.length; i += 500) {
            chunks.push(allTokens.slice(i, i + 500));
        }

        // 3. Chunk'ları paralel gönder, geçersiz token'ları topla
        const staleTokens: string[] = [];

        await Promise.all(
            chunks.map(async chunk => {
                const response = await admin.messaging().sendEachForMulticast({
                    tokens: chunk,
                    notification: params.notification,
                    data: params.data ?? {},
                    apns: {
                        payload: {
                            aps: { sound: "default", badge: 1 }
                        }
                    }
                });

                response.responses.forEach((res, i) => {
                    const code = res.error?.code ?? "";
                    if (
                        code === "messaging/registration-token-not-registered" ||
                        code === "messaging/invalid-registration-token"
                    ) {
                        staleTokens.push(chunk[i]);
                    }
                });
            })
        );

        // 4. Bayat token'ları arka planda temizle — ana akışı beklemesin
        if (staleTokens.length > 0) {
            cleanStaleTokens(staleTokens).catch(err =>
                console.error("cleanStaleTokens error:", err)
            );
        }

    } catch (err) {
        // Bildirim hatası ana işlemi (ödeme onayı vb.) asla durdurmamalı
        console.error("sendNotification error:", err);
    }
};