/**
 * Student registration data transfer object
 */
export interface RegisterStudentData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    gender?: string;
}
