/**
 * Package-based subscription assignment data
 */
export interface AssignPackageSubscriptionData {
    studentId: string;
    packageName: string;
    totalSessions: number;
    pricePerSession: number;
}

/**
 * Membership-based subscription assignment data
 */
export interface AssignMembershipSubscriptionData {
    studentId: string;
    planId: string;
    billingDayOfMonth: number;
}

/**
 * Union type for assignment data
 */
export type AssignSubscriptionData = AssignPackageSubscriptionData | AssignMembershipSubscriptionData;
