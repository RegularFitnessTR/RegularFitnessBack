import { DayOfWeek, ProgramType, IntensityLevel, TrainingGoal } from './schedule.enums';

// Haftalık şablon için seans (klasik salon)
export interface WorkoutSession {
    dayOfWeek: DayOfWeek;
    startTime: string;   // "09:00"
    endTime: string;     // "10:30"
    description: string;
}

// Haftalık tekrar eden şablon (klasik salon)
export interface WorkoutSchedule {
    id: string;
    studentId: string;
    studentName?: string; // denormalized display field
    coachId?: string;    // klasik salonda zorunlu değil, öğrenci de oluşturabilir
    coachName?: string;  // denormalized display field
    coachPhotoUrl?: string; // denormalized display field
    gymId: string;

    programName: string;
    programType?: ProgramType;
    intensity?: IntensityLevel;
    goal?: TrainingGoal;

    sessions: WorkoutSession[];
    isActive: boolean;

    createdBy: string;   // coach veya student UID
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}

// Spesifik randevu (reformer / paket bazlı salon)
export type AppointmentStatus = 'pending' | 'completed' | 'postponed' | 'cancelled';

export interface Appointment {
    id: string;
    studentId: string;
    studentName?: string; // denormalized display field
    coachId: string;
    coachName?: string;   // denormalized display field
    coachPhotoUrl?: string; // denormalized display field
    gymId: string;
    subscriptionId: string;  // hangi pakete bağlı

    sessionNumber: number;   // 8 seansın kaçıncısı (1-8)
    totalSessions: number;   // paketteki toplam seans (8)

    date: FirebaseFirestore.Timestamp;  // spesifik tarih+saat
    startTime: string;       // "09:00"
    endTime: string;         // "10:30"
    description?: string;

    status: AppointmentStatus;

    completedAt?: FirebaseFirestore.Timestamp;
    postponedAt?: FirebaseFirestore.Timestamp;
    postponedFrom?: FirebaseFirestore.Timestamp;  // orijinal tarih
    cancelledAt?: FirebaseFirestore.Timestamp;
    cancellationReason?: string;

    createdBy: string;
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}