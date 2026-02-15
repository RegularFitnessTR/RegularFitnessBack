import { UserRole } from '../../common/types/base';
import { LogAction, LogCategory } from './log.enums';

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
    action: LogAction;
    category: LogCategory;
    performedBy: LogPerformer;
    targetEntity?: LogTargetEntity;
    gymId?: string; // For admin-level filtering
    details?: Record<string, any>; // Action-specific extra info
    timestamp: FirebaseFirestore.Timestamp;
}
