import { DayOfWeek, ProgramType, IntensityLevel, TrainingGoal } from './schedule.enums';

/**
 * Individual workout session within a weekly schedule
 */
export interface WorkoutSession {
    dayOfWeek: DayOfWeek;         // 1=Monday, 2=Tuesday, ..., 7=Sunday
    startTime: string;            // "09:00" (HH:mm format)
    endTime: string;              // "12:30"
    description: string;          // Session description/notes
}

/**
 * Workout schedule - recurring weekly program
 */
export interface WorkoutSchedule {
    id: string;
    studentId: string;
    coachId: string;
    gymId: string;

    // Program metadata
    programName: string;
    programType?: ProgramType;
    intensity?: IntensityLevel;
    goal?: TrainingGoal;

    // Weekly sessions
    sessions: WorkoutSession[];

    // Status
    isActive: boolean;            // Can pause without deleting

    // Audit
    createdBy: string;            // Coach UID
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
