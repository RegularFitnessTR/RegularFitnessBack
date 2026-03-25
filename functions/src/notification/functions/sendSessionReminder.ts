// notifications/functions/sendSessionReminder.ts

import { onRequest } from "firebase-functions/v2/https";
import { db, COLLECTIONS } from "../../common";
import { sendNotification } from "../utils/sendNotification";

export const sendSessionReminder = onRequest(async (req, res) => {
    const { sessionId, coachId, studentId } = req.body;

    if (!sessionId || !coachId || !studentId) {
        res.status(400).send("Missing required fields.");
        return;
    }

    const sessionDoc = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();

    if (!sessionDoc.exists || sessionDoc.data()?.status === "cancelled") {
        res.status(200).send("Session not found or cancelled — skipping.");
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

    res.status(200).send("OK");
});