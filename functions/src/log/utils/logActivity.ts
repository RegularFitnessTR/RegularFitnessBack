import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { UserRole } from "../../common/types/base";
import { LogAction, LogCategory } from "../types/log.enums";
import { ActivityLog, LogTargetEntity } from "../types/log.model";

/**
 * Parameters for logging an activity
 */
export interface LogActivityParams {
    action: LogAction;
    category: LogCategory;
    performedBy: {
        uid: string;
        role: UserRole;
        name: string;
    };
    targetEntity?: LogTargetEntity;
    gymId?: string;
    details?: Record<string, any>;
}

/**
 * Writes an activity log to Firestore.
 * This function is designed to NEVER throw - errors are caught and logged to console.
 * It should never block or break the main operation.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
    try {
        const logRef = db.collection(COLLECTIONS.ACTIVITY_LOGS).doc();
        const logId = logRef.id;

        const logEntry: ActivityLog = {
            id: logId,
            action: params.action,
            category: params.category,
            performedBy: params.performedBy,
            timestamp: admin.firestore.Timestamp.now()
        };

        if (params.targetEntity) {
            logEntry.targetEntity = params.targetEntity;
        }

        if (params.gymId) {
            logEntry.gymId = params.gymId;
        }

        if (params.details) {
            logEntry.details = params.details;
        }

        await logRef.set(logEntry);
    } catch (error) {
        console.warn("[ActivityLog] Log kaydı yazılamadı:", error);
    }
}
