import { PaymentMethodType } from './gym.enums';

export interface Package {
    name: string;
    totalSessions: number;
    totalPrice: number;
    pricePerSession: number; // hesaplanan: totalPrice / totalSessions
}

export interface MembershipPlan {
    id: string;                  // uuid — güncelleme/silme için
    name: string;                // "Aylık Normal", "12 Ay Taahhütlü"
    durationMonths: number;      // 1, 6, 12, 24...
    monthlyPrice: number;
    totalPrice: number;          // hesaplanan: monthlyPrice × durationMonths
    hasCommitment: boolean;      // taahhütlü mü?
    isBase: boolean;             // taahhüt bitince dönülecek baz plan mı? (sadece 1 plan true olabilir, durationMonths=1 olanlar)
}

export interface PackagePaymentMethod {
    type: PaymentMethodType.PACKAGE;
    packages: Package[];
}

export interface MembershipPaymentMethod {
    type: PaymentMethodType.MEMBERSHIP;
    plans: MembershipPlan[];     // dinamik array, sabit 3 plan yok
}

export type PaymentMethod = PackagePaymentMethod | MembershipPaymentMethod;