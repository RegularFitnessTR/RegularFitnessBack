import * as admin from "firebase-admin";
import { UserRole } from "../../common/types/base";

export interface UserNotification {
    id: string;
    recipientId: string;
    recipientRole: UserRole;
    title: string;
    body: string;
    type: string;
    data: Record<string, string>;
    gymId?: string;
    isRead: boolean;
    createdAt: admin.firestore.Timestamp;
    readAt?: admin.firestore.Timestamp;
}
