import { ProgramType, IntensityLevel, TrainingGoal } from './schedule.enums';
import { WorkoutSession } from './schedule.model';

/**
 * Data for creating a new workout schedule
 */
export interface AssignWorkoutScheduleData {
    studentId: string;
    programName: string;
    programType?: ProgramType;
    intensity?: IntensityLevel;
    goal?: TrainingGoal;
    sessions: WorkoutSession[];
}

/**
 * Data for updating an existing workout schedule
 */
export interface UpdateWorkoutScheduleData {
    scheduleId: string;
    programName?: string;
    programType?: ProgramType;
    intensity?: IntensityLevel;
    goal?: TrainingGoal;
    sessions?: WorkoutSession[];
}

/**
 * Data for toggling schedule status
 */
export interface ToggleScheduleStatusData {
    scheduleId: string;
    isActive: boolean;
}
