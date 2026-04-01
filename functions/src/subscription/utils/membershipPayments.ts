import * as admin from "firebase-admin";
import { MonthlyPayment } from "../types/subscription.model";

export interface MembershipPaymentSource {
    startDate: admin.firestore.Timestamp;
    billingDayOfMonth: number;
    hasCommitment: boolean;
    totalMonths: number;
    monthlyPrice: number;
    baseMonthlyPrice: number;
    monthlyPayments?: MonthlyPayment[];
}

function buildDueDate(
    startDate: admin.firestore.Timestamp,
    monthNumber: number,
    billingDayOfMonth: number
): admin.firestore.Timestamp {
    const base = new Date(startDate.toMillis());
    const dueDate = new Date(base);

    dueDate.setMonth(base.getMonth() + (monthNumber - 1));
    dueDate.setDate(billingDayOfMonth);

    const expectedMonth = (base.getMonth() + (monthNumber - 1)) % 12;
    if (dueDate.getMonth() !== expectedMonth) {
        dueDate.setDate(0);
    }

    return admin.firestore.Timestamp.fromDate(dueDate);
}

function monthlyAmountForMonth(sub: MembershipPaymentSource, monthNumber: number): number {
    if (sub.hasCommitment && monthNumber <= sub.totalMonths) {
        return sub.monthlyPrice;
    }
    return sub.baseMonthlyPrice;
}

export function getElapsedMonthNumber(
    startDate: admin.firestore.Timestamp,
    now: admin.firestore.Timestamp = admin.firestore.Timestamp.now()
): number {
    const start = new Date(startDate.toMillis());
    const current = new Date(now.toMillis());

    const months =
        (current.getFullYear() - start.getFullYear()) * 12 +
        (current.getMonth() - start.getMonth()) +
        1;

    return Math.max(1, months);
}

export function ensureMonthlyPaymentsUpToMonth(
    sub: MembershipPaymentSource,
    targetMonthNumber: number
): MonthlyPayment[] {
    const existing = sub.monthlyPayments || [];
    const existingMap = new Map<number, MonthlyPayment>();

    existing.forEach((payment) => {
        if (payment?.month && payment.month > 0) {
            existingMap.set(payment.month, payment);
        }
    });

    const existingMaxMonth = existing.reduce((max, payment) => {
        const month = payment?.month || 0;
        return month > max ? month : max;
    }, 0);

    const maxMonth = Math.max(existingMaxMonth, targetMonthNumber);
    const normalized: MonthlyPayment[] = [];

    for (let month = 1; month <= maxMonth; month++) {
        const existingPayment = existingMap.get(month);
        if (existingPayment) {
            normalized.push(existingPayment);
            continue;
        }

        normalized.push({
            month,
            dueDate: buildDueDate(sub.startDate, month, sub.billingDayOfMonth),
            amount: monthlyAmountForMonth(sub, month),
            status: "pending"
        });
    }

    return normalized;
}
