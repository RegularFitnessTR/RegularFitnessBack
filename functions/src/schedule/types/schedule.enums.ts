/**
 * Day of week (ISO week standard)
 */
export enum DayOfWeek {
    MONDAY = 1,
    TUESDAY = 2,
    WEDNESDAY = 3,
    THURSDAY = 4,
    FRIDAY = 5,
    SATURDAY = 6,
    SUNDAY = 7
}

/**
 * Workout program type
 */
export enum ProgramType {
    STRENGTH = 'strength',
    CARDIO = 'cardio',
    HIIT = 'hiit',
    BOXING = 'boxing',
    SWIMMING = 'swimming',
    YOGA = 'yoga',
    PILATES = 'pilates',
    CROSSFIT = 'crossfit',
    GENERAL = 'general'
}

/**
 * Training intensity level
 */
export enum IntensityLevel {
    BEGINNER = 'beginner',
    INTERMEDIATE = 'intermediate',
    ADVANCED = 'advanced'
}

/**
 * Training goal
 */
export enum TrainingGoal {
    WEIGHT_LOSS = 'weight_loss',
    MUSCLE_GAIN = 'muscle_gain',
    ENDURANCE = 'endurance',
    STRENGTH = 'strength',
    FLEXIBILITY = 'flexibility',
    GENERAL_FITNESS = 'general_fitness'
}
