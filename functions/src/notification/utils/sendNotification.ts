// notifications/utils/sendNotification.ts

import * as admin from "firebase-admin";
import { Message } from "firebase-admin/messaging";
import { UserRole } from "../../common/types/base";
import { logError } from "../../log/utils/logError";
import { LogSeverity } from "../../log/types/log.enums";
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

const STALE_TOKEN_RETRY_COUNT = 2;

async function cleanStaleTokensWithRetry(staleTokens: string[]): Promise<void> {
    if (staleTokens.length === 0) return;

    for (let attempt = 1; attempt <= STALE_TOKEN_RETRY_COUNT + 1; attempt++) {
        try {
            await cleanStaleTokens(staleTokens);
            return;
        } catch (cleanupError) {
            if (attempt > STALE_TOKEN_RETRY_COUNT) {
                await logError({
                    functionName: "sendNotification.cleanStaleTokens",
                    error: cleanupError,
                    severity: LogSeverity.ERROR,
                    requestData: {
                        staleTokenCount: staleTokens.length,
                        attempts: attempt,
                    },
                });
                return;
            }

            await logError({
                functionName: "sendNotification.cleanStaleTokens.retry",
                error: cleanupError,
                severity: LogSeverity.WARNING,
                requestData: {
                    staleTokenCount: staleTokens.length,
                    attempt,
                },
            });

            await new Promise((resolve) => setTimeout(resolve, attempt * 200));
        }
    }
}

/**
 * Tüm kullanıcıları tek seferde, kişiselleştirilmiş data (notificationId dahil)
 * ile FCM'e gönderir. sendEach() ile 500'lük batch'ler halinde çalışır.
 *
 * @param uidToData uid başına farklı data eklemek için opsiyonel map.
 *                  Verilmezse params.data tüm kullanıcılara uygulanır.
 */
export const sendNotification = async (
    params: SendNotificationParams,
    uidToData?: Map<string, Record<string, string>>
): Promise<void> => {
    try {
        // 1. Tüm roller için token'ları paralel topla
        const entries = (
            await Promise.all(
                params.recipients.map(r => getTokensByRole(r.ids, r.role))
            )
        ).flat();

        if (entries.length === 0) return;

        // 2. Token bazlı dedupe — mesajları ve token sırasını ayrı tut
        const seenTokens = new Set<string>();
        const messages: Message[] = [];
        const orderedTokens: string[] = [];

        for (const entry of entries) {
            if (seenTokens.has(entry.token)) continue;
            seenTokens.add(entry.token);

            const perUidData = uidToData?.get(entry.uid);
            const mergedData = perUidData
                ? { ...(params.data ?? {}), ...perUidData }
                : (params.data ?? {});

            messages.push({
                token: entry.token,
                notification: params.notification,
                data: mergedData,
                apns: {
                    payload: { aps: { sound: "default", badge: 1 } }
                }
            });
            orderedTokens.push(entry.token);
        }

        // 3. FCM limiti: sendEach() max 500 mesaj/istek
        const staleTokens: string[] = [];

        for (let i = 0; i < messages.length; i += 500) {
            const chunk = messages.slice(i, i + 500);
            const tokenChunk = orderedTokens.slice(i, i + 500);
            const response = await admin.messaging().sendEach(chunk);

            if (response.failureCount > 0) {
                const errorCodes = response.responses
                    .map((res) => res.error?.code)
                    .filter((code): code is string => Boolean(code));

                await logError({
                    functionName: "sendNotification.sendEach",
                    error: new Error(`FCM sendEach partial failure: ${response.failureCount}/${chunk.length}`),
                    severity: LogSeverity.WARNING,
                    requestData: {
                        totalMessages: chunk.length,
                        failureCount: response.failureCount,
                        errorCodes: [...new Set(errorCodes)],
                    },
                });
            }

            response.responses.forEach((res, idx) => {
                const code = res.error?.code ?? "";
                if (
                    code === "messaging/registration-token-not-registered" ||
                    code === "messaging/invalid-registration-token"
                ) {
                    staleTokens.push(tokenChunk[idx]);
                }
            });
        }

        // 4. Bayat token temizliğini retry ile güvenilir hale getir
        if (staleTokens.length > 0) {
            await cleanStaleTokensWithRetry(staleTokens);
        }

    } catch (err) {
        // Bildirim hatası ana işlemi (ödeme onayı vb.) asla durdurmamalı
        console.error("sendNotification error:", err);

        await logError({
            functionName: "sendNotification",
            error: err,
            severity: LogSeverity.ERROR,
            requestData: {
                recipientGroupCount: params.recipients.length,
                notificationType: params.data?.type ?? "general",
            },
        });
    }
};