import { PaymentMethodType } from '../../gym/types/gym.enums';
import { PaymentStatus } from './payment.enums';

/**
 * Payment request for package-based gym
 */
export interface PackagePaymentRequest {
    id: string;
    studentId: string;
    subscriptionId: string;
    gymId: string;
    type: PaymentMethodType.PACKAGE;
    sessionCount: number;          // Number of sessions being paid for
    pricePerSession: number;
    totalAmount: number;            // sessionCount × pricePerSession
    status: PaymentStatus;
    createdAt: FirebaseFirestore.Timestamp;
    processedAt?: FirebaseFirestore.Timestamp;
    processedBy?: string;
    notes?: string;
}

/**
 * Payment request for membership-based gym
 */
export interface MembershipPaymentRequest {
    id: string;
    studentId: string;
    subscriptionId: string;
    gymId: string;
    type: PaymentMethodType.MEMBERSHIP;
    monthNumber: number;            // Which month is being paid (1-12)
    monthlyAmount: number;
    status: PaymentStatus;
    createdAt: FirebaseFirestore.Timestamp;
    processedAt?: FirebaseFirestore.Timestamp;
    processedBy?: string;
    notes?: string;
}

/**
 * Discriminated union for payment requests
 */
export type PaymentRequest = PackagePaymentRequest | MembershipPaymentRequest;
