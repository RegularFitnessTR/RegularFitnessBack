import { BaseUser } from '../../common/types/base';

/**
 * Student User - Stored in 'students' collection
 */
export interface StudentUser extends BaseUser {
    role: 'student';
    gymId: string;   // Empty string if no gym assigned
    coachId: string; // Empty string if no coach assigned
    birthDate?: FirebaseFirestore.Timestamp;
    gender?: "male" | "female" | "other";
    medicalConditions?: string;
    activeSubscriptionId?: string; // Link to active subscription
    pendingPaymentCount?: number;  // Updated by Cloud Functions on payment request create/approve/reject
    isInGym?: boolean;             // Updated by Cloud Functions on gym check-in/check-out
}
