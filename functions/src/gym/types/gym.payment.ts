import { PaymentMethodType } from './gym.enums';

/**
 * Package definition for package-based payment
 */
export interface Package {
    name: string;
    totalSessions: number;      // Total sessions in package (e.g., 12)
    totalPrice: number;          // Total package price (e.g., 24000)
    pricePerSession: number;    // Price per session (e.g., 2000) - calculated: totalPrice / totalSessions
}

/**
 * Membership plan with monthly pricing
 */
export interface MembershipPlan {
    name: string;
    monthlyPrice: number;       // Monthly payment amount (e.g., 2500)
    durationMonths: number;     // Duration in months (1, 6, or 12)
    totalPrice: number;         // Total price - calculated: monthlyPrice × durationMonths
}

/**
 * Package-based payment method
 */
export interface PackagePaymentMethod {
    type: PaymentMethodType.PACKAGE;
    packages: Package[];
}

/**
 * Membership-based payment method
 */
export interface MembershipPaymentMethod {
    type: PaymentMethodType.MEMBERSHIP;
    monthly: MembershipPlan;
    sixMonths: MembershipPlan;
    yearly: MembershipPlan;
}

/**
 * Discriminated union for payment methods
 */
export type PaymentMethod = PackagePaymentMethod | MembershipPaymentMethod;
