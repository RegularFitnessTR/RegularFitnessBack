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
    gymPublicId?: string; // Optional - gym public ID to join during registration
}
