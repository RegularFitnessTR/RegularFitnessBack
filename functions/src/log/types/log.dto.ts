import { LogAction, LogCategory, LogSeverity } from './log.enums';

/**
 * DTO for querying logs
 */
export interface GetLogsData {
    /** Number of logs to return (default: 50, max: 200) */
    limit?: number;
    /** Document ID to start after for pagination */
    startAfter?: string;
    /** Filter by category */
    category?: LogCategory;
    /** Filter by action */
    action?: LogAction;
    /** Filter by date range - start */
    startDate?: string; // ISO date string
    /** Filter by date range - end */
    endDate?: string; // ISO date string
}

/**
 * DTO for querying error logs
 */
export interface GetErrorLogsData {
    /** Number of logs to return (default: 50, max: 200) */
    limit?: number;
    /** Document ID to start after for pagination */
    startAfter?: string;
    /** Filter by severity */
    severity?: LogSeverity;
    /** Filter by function name */
    functionName?: string;
    /** Filter by resolved status */
    resolved?: boolean;
    /** Filter by date range - start */
    startDate?: string; // ISO date string
    /** Filter by date range - end */
    endDate?: string; // ISO date string
}

