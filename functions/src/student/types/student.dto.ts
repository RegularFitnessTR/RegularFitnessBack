/**
 * Student registration data transfer object
 */
export interface RegisterStudentData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    gender?: "male" | "female" | "other";
    birthDate?: FirebaseFirestore.Timestamp; // timestamp as ms string/number or similar format
    gymPublicId?: string; // Optional - gym public ID to join during registration
}

/**
 * Student profile update data transfer object
 */
export interface UpdateStudentProfileData {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    gender?: "male" | "female" | "other";
    medicalConditions?: string;
    birthDate?: FirebaseFirestore.Timestamp; // timestamp as ms string/number or similar format
}

/**
 * Student password update data transfer object
 */
export interface UpdateStudentPasswordData {
    newPassword: string;
}
