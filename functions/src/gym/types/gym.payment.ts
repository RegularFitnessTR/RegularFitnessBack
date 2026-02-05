import { PaymentMethodType } from './gym.enums';

/**
 * Package definition for package-based payment
 */
export interface Package {
    name: string;           // "Standart Paket"
    sessionCount: number;   // 8 ders
    basePrice: number;      // 24000 TL
}

/**
 * Membership plan (monthly, 6-months, yearly)
 */
export interface MembershipPlan {
    name: string;
    price: number;
}

/**
 * Package-based payment method
 */
export interface PackagePaymentMethod {
    type: PaymentMethodType.PACKAGE;
    packages: Package[];  // Admin can define multiple packages
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
 * TypeScript can discriminate based on 'type' field
 */
export type PaymentMethod = PackagePaymentMethod | MembershipPaymentMethod;
