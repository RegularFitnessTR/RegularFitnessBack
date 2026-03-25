// notifications/utils/scheduleSessionReminder.ts

import { CloudTasksClient } from "@google-cloud/tasks";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";

const client = new CloudTasksClient();
const PROJECT = process.env.GCLOUD_PROJECT!;
const LOCATION = "europe-west1";
const QUEUE = "session-reminders";
const FUNCTION_URL =
    `https://${LOCATION}-${PROJECT}.cloudfunctions.net/sendSessionReminder`;

export const scheduleSessionReminder = async (
    sessionId: string,
    sessionStartTime: FirebaseFirestore.Timestamp,
    coachId: string,
    studentId: string
): Promise<void> => {

    const reminderTime = new Date(sessionStartTime.toMillis() - 15 * 60 * 1000);
    if (reminderTime <= new Date()) return; // Geçmiş zaman — task oluşturma

    const payload = JSON.stringify({ sessionId, coachId, studentId });

    const [task] = await client.createTask({
        parent: client.queuePath(PROJECT, LOCATION, QUEUE),
        task: {
            httpRequest: {
                httpMethod: "POST",
                url: FUNCTION_URL,
                headers: { "Content-Type": "application/json" },
                body: Buffer.from(payload).toString("base64"),
            },
            scheduleTime: {
                seconds: Math.floor(reminderTime.getTime() / 1000)
            },
        },
    });

    // taskName'i session'a yaz — iptal için şart
    await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
        reminderTaskName: task.name
    });
};

export const cancelSessionReminder = async (sessionId: string): Promise<void> => {
    const doc = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();
    const taskName = doc.data()?.reminderTaskName;
    if (!taskName) return;

    try {
        await client.deleteTask({ name: taskName });
    } catch (err: any) {
        if (err.code !== 5) throw err; // 5 = NOT_FOUND, task zaten çalışmış demektir
    }

    await doc.ref.update({
        reminderTaskName: admin.firestore.FieldValue.delete()
    });
};