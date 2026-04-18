// notifications/functions/sendSessionReminder.ts

import { onRequest } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { logError } from "../../log/utils/logError";
import { LogSeverity } from "../../log/types/log.enums";
import { sendNotification } from "../utils/sendNotification";

export const sendSessionReminder = onRequest(async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({
            success: false,
            error: {
                code: "method-not-allowed",
                message: "Only POST is supported.",
            },
        });
        return;
    }

    try {
        const body = typeof req.body === "object" && req.body !== null ? req.body : {};
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const coachId = typeof body.coachId === "string" ? body.coachId : "";
        const studentId = typeof body.studentId === "string" ? body.studentId : "";

        if (!sessionId || !coachId || !studentId) {
            res.status(400).json({
                success: false,
                error: {
                    code: "invalid-argument",
                    message: "sessionId, coachId ve studentId zorunludur.",
                },
            });
            return;
        }

        const sessionDoc = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();

        if (!sessionDoc.exists || sessionDoc.data()?.status === "cancelled") {
            res.status(200).json({
                success: true,
                skipped: true,
                reason: "session-not-found-or-cancelled",
            });
            return;
        }

        await sendNotification({
            recipients: [
                { ids: [coachId], role: "coach" },
                { ids: [studentId], role: "student" }
            ],
            notification: {
                title: "Seans 15 Dakika Sonra",
                body: "Seansınız 15 dakika içinde başlıyor."
            },
            data: {
                type: "session_reminder",
                sessionId
            }
        });

        res.status(200).json({
            success: true,
            sent: true,
        });
    } catch (error) {
        void logError({
            functionName: "sendSessionReminder",
            error,
            severity: LogSeverity.ERROR,
            requestData: {
                method: req.method,
            },
        });

        res.status(500).json({
            success: false,
            error: {
                code: "internal",
                message: "Session reminder gonderilirken bir hata olustu.",
            },
        });
    }
});