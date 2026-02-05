/**
 * User role type
 */
export type UserRole = 'student' | 'coach' | 'admin' | 'superadmin';

/**
 * Base user interface - common fields for all user types
 */
export interface BaseUser {
    uid: string;
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    photoUrl: string;
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
