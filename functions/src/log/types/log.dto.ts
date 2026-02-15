import { LogAction, LogCategory } from './log.enums';

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
