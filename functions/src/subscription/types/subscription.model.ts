import { PaymentMethodType } from '../../gym/types/gym.enums';
import { SubscriptionStatus } from './subscription.enums';

/**
 * Monthly payment record for membership subscriptions
 */
export interface MonthlyPayment {
    month: number;                    // Month number (1-12)
    dueDate: FirebaseFirestore.Timestamp;
    amount: number;
    status: 'pending' | 'paid';
    paidDate?: FirebaseFirestore.Timestamp;
    paymentRequestId?: string;
}

/**
 * Base subscription interface
 */
interface BaseSubscription {
    id: string;
    studentId: string;
    coachId: string;
    gymId: string;
    status: SubscriptionStatus;
    assignedAt: FirebaseFirestore.Timestamp;
    assignedBy: string;
    updatedAt?: FirebaseFirestore.Timestamp;
}

/**
 * Package-based subscription with session and debt tracking
 */
export interface PackageSubscription extends BaseSubscription {
    type: PaymentMethodType.PACKAGE;
    packageName: string;
    pricePerSession: number;          // Price per session (e.g., 2000)
    totalSessions: number;             // Total sessions in package (e.g., 12)

    // Session tracking
    sessionsUsed: number;              // Sessions consumed so far
    sessionsRemaining: number;        // totalSessions - sessionsUsed

    // Debt tracking
    totalDebt: number;                 // sessionsUsed × pricePerSession
    totalPaid: number;                 // Total amount paid
    currentBalance: number;           // totalPaid - totalDebt (negative = debt, positive = credit)
}

/**
 * Membership-based subscription with monthly payment tracking
 */
export interface MembershipSubscription extends BaseSubscription {
    type: PaymentMethodType.MEMBERSHIP;
    membershipType: 'monthly' | 'sixMonths' | 'yearly';
    membershipName: string;
    monthlyPayment: number;           // Amount to pay each month
    totalMonths: number;               // Duration in months
    totalAmount: number;               // monthlyPayment × totalMonths

    // Date range
    startDate: FirebaseFirestore.Timestamp;
    endDate: FirebaseFirestore.Timestamp;

    // Monthly payment tracking
    monthlyPayments: MonthlyPayment[];

    // Financial tracking
    totalPaid: number;
    currentBalance: number;           // totalAmount - totalPaid
}

/**
 * Discriminated union for subscriptions
 */
export type Subscription = PackageSubscription | MembershipSubscription;
