import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { LogSeverity } from "../types/log.enums";
import { ErrorLog } from "../types/log.model";

/**
 * Parameters for logging an error
 */
export interface LogErrorParams {
    functionName: string;
    error: any;
    userId?: string;
    userRole?: string;
    requestData?: Record<string, any>;
    severity?: LogSeverity;
}

/**
 * Sanitizes request data to remove sensitive fields before logging.
 */
function sanitizeRequestData(data: Record<string, any>): Record<string, any> {
    const sensitiveFields = ['password', 'token', 'secret', 'creditCard', 'cvv'];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
        if (sensitiveFields.includes(key.toLowerCase())) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
            sanitized[key] = sanitizeRequestData(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Writes an error log to Firestore.
 * This function is designed to NEVER throw - errors are caught and logged to console.
 * It should never block or break the main operation.
 */
export async function logError(params: LogErrorParams): Promise<void> {
    try {
        const logRef = db.collection(COLLECTIONS.ERROR_LOGS).doc();
        const logId = logRef.id;

        // Extract error details
        const errorCode = params.error?.code || params.error?.name || 'UNKNOWN';
        const errorMessage = params.error?.message || String(params.error) || 'Bilinmeyen hata';
        const stackTrace = params.error?.stack || undefined;

        const logEntry: ErrorLog = {
            id: logId,
            functionName: params.functionName,
            severity: params.severity || LogSeverity.ERROR,
            errorCode: String(errorCode),
            errorMessage: errorMessage,
            resolved: false,
            timestamp: admin.firestore.Timestamp.now()
        };

        if (stackTrace) {
            logEntry.stackTrace = stackTrace;
        }

        if (params.userId) {
            logEntry.userId = params.userId;
        }

        if (params.userRole) {
            logEntry.userRole = params.userRole;
        }

        if (params.requestData) {
            logEntry.requestData = sanitizeRequestData(params.requestData);
        }

        await logRef.set(logEntry);
    } catch (logErr) {
        // Never throw from error logging - just console.warn
        console.warn("[ErrorLog] Hata log kaydı yazılamadı:", logErr);
    }
}
