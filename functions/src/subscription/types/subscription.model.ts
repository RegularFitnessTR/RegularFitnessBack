import { PaymentMethodType } from '../../gym/types/gym.enums';
import { SubscriptionStatus } from './subscription.enums';

export interface MonthlyPayment {
    month: number;
    dueDate: FirebaseFirestore.Timestamp;
    amount: number;
    status: 'pending' | 'paid';
    paidDate?: FirebaseFirestore.Timestamp;
    paymentRequestId?: string;
}

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

export interface PackageSubscription extends BaseSubscription {
    type: PaymentMethodType.PACKAGE;
    packageName: string;
    pricePerSession: number;
    totalSessions: number;
    sessionsUsed: number;
    sessionsRemaining: number;
    totalDebt: number;
    totalPaid: number;
    currentBalance: number;
}

export interface MembershipSubscription extends BaseSubscription {
    type: PaymentMethodType.MEMBERSHIP;

    // Plan bilgisi (atama anındaki snapshot — plan sonradan değişse bile korunur)
    planId: string;
    planName: string;
    monthlyPrice: number;
    totalMonths: number;
    totalAmount: number;

    // Taahhüt
    hasCommitment: boolean;
    commitmentEndsAt?: FirebaseFirestore.Timestamp; // hasCommitment=true ise dolu
    isCommitmentActive: boolean;                    // cronjob bu alanı false yapar

    // Taahhüt bitince dönülecek baz fiyat (gymden otomatik alınır)
    baseMonthlyPrice: number;

    // Tarihler
    startDate: FirebaseFirestore.Timestamp;
    endDate: FirebaseFirestore.Timestamp;           // taahhüt sonu, sonrasında açık uçlu devam

    // Ödeme takibi
    billingDayOfMonth: number;                      // her ayın kaçında ödeme? (1-28)
    monthlyPayments: MonthlyPayment[];
    totalPaid: number;
    currentBalance: number;

    // İptal (erken iptal durumunda dolar)
    cancelledAt?: FirebaseFirestore.Timestamp;
    cancellationDebt?: number;                      // cayma bedeli
    cancellationReason?: string;
}

export type Subscription = PackageSubscription | MembershipSubscription;