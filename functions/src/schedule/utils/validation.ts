import { WorkoutSession } from '../types/schedule.model';

/**
 * Validates time format (HH:mm)
 */
export function validateTimeFormat(time: string): boolean {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
}

/**
 * Validates that startTime is before endTime
 */
export function validateTimeRange(startTime: string, endTime: string): boolean {
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    return startMinutes < endMinutes;
}

/**
 * Validates workout session
 */
export function validateSession(session: WorkoutSession): { valid: boolean; error?: string } {
    // Validate day of week
    if (session.dayOfWeek < 1 || session.dayOfWeek > 7) {
        return { valid: false, error: 'Geçersiz gün. 1 (Pazartesi) - 7 (Pazar) arası olmalıdır.' };
    }

    // Validate time format
    if (!validateTimeFormat(session.startTime)) {
        return { valid: false, error: 'Geçersiz başlangıç saati formatı. HH:mm formatında olmalıdır.' };
    }

    if (!validateTimeFormat(session.endTime)) {
        return { valid: false, error: 'Geçersiz bitiş saati formatı. HH:mm formatında olmalıdır.' };
    }

    // Validate time range
    if (!validateTimeRange(session.startTime, session.endTime)) {
        return { valid: false, error: 'Başlangıç saati bitiş saatinden önce olmalıdır.' };
    }

    // Validate description
    if (!session.description || session.description.trim().length === 0) {
        return { valid: false, error: 'Açıklama boş olamaz.' };
    }

    return { valid: true };
}

/**
 * Validates all sessions in an array
 */
export function validateSessions(sessions: WorkoutSession[]): { valid: boolean; error?: string } {
    if (!sessions || sessions.length === 0) {
        return { valid: false, error: 'En az bir çalışma günü belirtilmelidir.' };
    }

    for (let i = 0; i < sessions.length; i++) {
        const result = validateSession(sessions[i]);
        if (!result.valid) {
            return { valid: false, error: `Seans ${i + 1}: ${result.error}` };
        }
    }

    return { valid: true };
}
