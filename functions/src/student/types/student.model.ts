import { BaseUser } from '../../common/types/base';

/**
 * Student User - Stored in 'students' collection
 */
export interface StudentUser extends BaseUser {
    role: 'student';
    coachId: string; // Empty string if no coach assigned
    birthDate?: FirebaseFirestore.Timestamp;
    gender?: string;
    height?: number; // cm
    weight?: number; // kg
    medicalConditions?: string;
    activeSubscriptionId?: string; // Link to active subscription
}
