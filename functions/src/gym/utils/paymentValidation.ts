import { HttpsError } from "firebase-functions/v2/https";
import { v4 as uuidv4 } from "uuid";
import { GymType, PaymentMethodType } from "../types/gym.enums";
import {
    MembershipPaymentMethod,
    MembershipPlan,
    Package,
    PackagePaymentMethod,
    PaymentMethod
} from "../types/gym.payment";

const GYM_TYPE_ALIASES: Record<string, GymType> = {
    reformer: GymType.REFORMER,
    package: GymType.REFORMER,
    package_based: GymType.REFORMER,
    paket: GymType.REFORMER,
    classic: GymType.CLASSIC,
    klasik: GymType.CLASSIC,
    membership: GymType.CLASSIC,
    membership_based: GymType.CLASSIC
};

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

function normalizeName(name: string, label: string): string {
    const trimmed = (name || "").trim();
    if (!trimmed) {
        throw new HttpsError("invalid-argument", `${label} boş olamaz.`);
    }
    return trimmed;
}

function assertPositiveNumber(value: number, label: string): void {
    if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
        throw new HttpsError("invalid-argument", `${label} 0'dan büyük bir sayı olmalıdır.`);
    }
}

function assertPositiveInteger(value: number, label: string): void {
    assertPositiveNumber(value, label);
    if (!Number.isInteger(value)) {
        throw new HttpsError("invalid-argument", `${label} pozitif tam sayı olmalıdır.`);
    }
}

function normalizePaymentMethodType(rawType: unknown): PaymentMethodType {
    if (rawType === PaymentMethodType.PACKAGE || rawType === PaymentMethodType.MEMBERSHIP) {
        return rawType;
    }
    throw new HttpsError(
        "invalid-argument",
        "Geçersiz ödeme yöntemi tipi. Sadece package veya membership kullanılabilir."
    );
}

export function normalizeGymType(rawGymType: unknown): GymType {
    if (typeof rawGymType !== "string") {
        throw new HttpsError("invalid-argument", "Salon tipi zorunludur.");
    }

    const normalized = rawGymType.trim().toLowerCase();
    const mapped = GYM_TYPE_ALIASES[normalized];

    if (!mapped) {
        throw new HttpsError(
            "invalid-argument",
            "Geçersiz salon tipi. Sadece reformer (paket) veya classic (üyelik) kullanılabilir."
        );
    }

    return mapped;
}

export function normalizePackage(pkg: Package): Package {
    const name = normalizeName(pkg?.name, "Paket adı");
    assertPositiveInteger(pkg?.totalSessions, "Toplam seans");
    assertPositiveNumber(pkg?.totalPrice, "Toplam fiyat");

    return {
        name,
        totalSessions: pkg.totalSessions,
        totalPrice: roundCurrency(pkg.totalPrice),
        pricePerSession: roundCurrency(pkg.totalPrice / pkg.totalSessions)
    };
}

export function normalizePackages(packages: Package[]): Package[] {
    if (!Array.isArray(packages) || packages.length === 0) {
        throw new HttpsError("invalid-argument", "En az bir paket tanımlanmalıdır.");
    }

    const normalized = packages.map(normalizePackage);
    const names = new Set<string>();

    normalized.forEach((pkg) => {
        const key = pkg.name.toLowerCase();
        if (names.has(key)) {
            throw new HttpsError("already-exists", `Aynı isimde birden fazla paket olamaz: ${pkg.name}`);
        }
        names.add(key);
    });

    return normalized;
}

export function normalizeMembershipPlan(plan: MembershipPlan): MembershipPlan {
    const name = normalizeName(plan?.name, "Plan adı");
    assertPositiveInteger(plan?.durationMonths, "Plan süresi");
    assertPositiveNumber(plan?.monthlyPrice, "Aylık fiyat");

    const hasCommitment = Boolean(plan?.hasCommitment);
    const isBase = Boolean(plan?.isBase);

    if (hasCommitment && plan.durationMonths <= 1) {
        throw new HttpsError("invalid-argument", "Taahhütlü plan süresi 1 aydan fazla olmalıdır.");
    }

    if (isBase && (hasCommitment || plan.durationMonths !== 1)) {
        throw new HttpsError("invalid-argument", "Baz plan taahhütsüz ve aylık (1 ay) olmalıdır.");
    }

    return {
        id: plan?.id || uuidv4(),
        name,
        durationMonths: plan.durationMonths,
        monthlyPrice: roundCurrency(plan.monthlyPrice),
        totalPrice: roundCurrency(plan.monthlyPrice * plan.durationMonths),
        hasCommitment,
        isBase
    };
}

export function normalizeMembershipPlans(plans: MembershipPlan[]): MembershipPlan[] {
    if (!Array.isArray(plans) || plans.length === 0) {
        throw new HttpsError("invalid-argument", "En az bir üyelik planı tanımlanmalıdır.");
    }

    const normalized = plans.map(normalizeMembershipPlan);
    const basePlans = normalized.filter((plan) => plan.isBase);

    if (basePlans.length !== 1) {
        throw new HttpsError("invalid-argument", "Tam olarak bir baz plan tanımlanmalıdır.");
    }

    const ids = new Set<string>();
    const names = new Set<string>();

    normalized.forEach((plan) => {
        if (ids.has(plan.id)) {
            throw new HttpsError("already-exists", `Plan ID çakışması: ${plan.id}`);
        }
        ids.add(plan.id);

        const key = plan.name.toLowerCase();
        if (names.has(key)) {
            throw new HttpsError("already-exists", `Aynı isimde birden fazla plan olamaz: ${plan.name}`);
        }
        names.add(key);
    });

    return normalized;
}

export function normalizePaymentMethod(paymentMethod: PaymentMethod): PaymentMethod {
    const type = normalizePaymentMethodType(paymentMethod?.type);

    if (type === PaymentMethodType.PACKAGE) {
        const packageMethod = paymentMethod as PackagePaymentMethod;
        return {
            type,
            packages: normalizePackages(packageMethod.packages || [])
        };
    }

    const membershipMethod = paymentMethod as MembershipPaymentMethod;
    return {
        type,
        plans: normalizeMembershipPlans(membershipMethod.plans || [])
    };
}

export function assertGymTypePaymentCompatibility(
    gymType: GymType,
    paymentType: PaymentMethodType
): void {
    if (gymType === GymType.REFORMER && paymentType !== PaymentMethodType.PACKAGE) {
        throw new HttpsError(
            "invalid-argument",
            "Reformer salonlarda ödeme yöntemi package olmalıdır."
        );
    }

    if (gymType === GymType.CLASSIC && paymentType !== PaymentMethodType.MEMBERSHIP) {
        throw new HttpsError(
            "invalid-argument",
            "Classic salonlarda ödeme yöntemi membership olmalıdır."
        );
    }
}

export function gymTypeFromPaymentType(paymentType: PaymentMethodType): GymType {
    return paymentType === PaymentMethodType.PACKAGE ? GymType.REFORMER : GymType.CLASSIC;
}
