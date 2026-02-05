/**
 * Package payment request data
 */
export interface CreatePackagePaymentData {
    sessionCount: number;  // Number of sessions to pay for
}

/**
 * Membership payment request data
 */
export interface CreateMembershipPaymentData {
    monthNumber: number;  // Which month to pay (1-12)
}

/**
 * Union type for payment request creation
 */
export type CreatePaymentRequestData = CreatePackagePaymentData | CreateMembershipPaymentData;

/**
 * Payment approval/rejection data
 */
export interface ProcessPaymentData {
    paymentRequestId: string;
    notes?: string;
}
