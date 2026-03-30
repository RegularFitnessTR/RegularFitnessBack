import { UserRole } from '../../common/types/base';
import { LogAction, LogCategory, LogSeverity } from './log.enums';

/**
 * Performer information - who performed the action
 */
export interface LogPerformer {
    uid: string;
    role: UserRole;
    name: string; // "firstName lastName"
}

/**
 * Target entity information - what was affected
 */
export interface LogTargetEntity {
    id: string;
    type: string; // 'coach', 'student', 'gym', 'admin', etc.
    name?: string; // Entity name if available
}

/**
 * Activity Log - Stored in 'activityLogs' collection
 */
export interface ActivityLog {
    id: string;
    title?: string;
    action: LogAction;
    category: LogCategory;
    performedBy: LogPerformer;
    targetEntity?: LogTargetEntity;
    gymId?: string; // For admin-level filtering
    details?: Record<string, any>; // Action-specific extra info
    timestamp: FirebaseFirestore.Timestamp;
}

/**
 * Error Log - Stored in 'errorLogs' collection
 * Captures all errors that occur in Cloud Functions
 */
export interface ErrorLog {
    id: string;
    functionName: string;
    severity: LogSeverity;
    errorCode: string;
    errorMessage: string;
    stackTrace?: string;
    userId?: string;
    userRole?: string;
    requestData?: Record<string, any>;
    resolved: boolean;
    timestamp: FirebaseFirestore.Timestamp;
}
