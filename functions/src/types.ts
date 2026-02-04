export type UserRole = 'student' | 'coach' | 'admin' | 'superadmin';

export interface AppUser {
    uid: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    photoUrl?: string;
    createdAt: FirebaseFirestore.Timestamp;
    // Öğrenciye özel alanlar (Optional yapılır çünkü Hoca'da bunlar olmayacak)
    coachId?: string;
    birthDate?: FirebaseFirestore.Timestamp;
    gender?: string;
    height?: number;
    weight?: number;
    medicalConditions?: string;
    activeSubscriptionId?: string;
    remainingSessions?: number;
    // Hocaya özel alanlar
    expertise?: string;
    experienceYears?: number;
    qrCodeString?: string;
}

// Frontend'den kayıt olurken gelecek veri paketi
export interface RegisterStudentData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
}

export interface RegisterAdminData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
}

export interface RegisterSuperAdminData extends RegisterAdminData {
    masterKey: string;
}