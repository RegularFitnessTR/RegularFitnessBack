import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError, serializeTimestamps } from "../../common";
import { PaymentStatus } from "../types/payment.enums";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logError } from "../../log/utils/logError";

interface GetPaymentRequestsData {
    status?: PaymentStatus;
    gymId?: string;
    limit?: number;
    startAfterTimestamp?: number;
}

interface QueryByGymIdsOptions {
    status?: PaymentStatus;
    limit: number;
    startAfterTimestamp?: number;
}

interface PaymentQueryResult {
    docs: FirebaseFirestore.DocumentData[];
    hasMore: boolean;
    lastTimestamp: number | null;
}

function mapUnexpectedPaymentError(error: any): HttpsError {
    const rawCode = String(error?.code ?? '').toLowerCase();
    const rawMessage = String(error?.message ?? '');

    if (rawCode.includes('failed-precondition') || rawCode === '9') {
        return new HttpsError('failed-precondition', 'Ödeme sorgusu için gerekli Firestore indexi eksik veya hazır değil.');
    }

    if (rawCode.includes('permission-denied') || rawCode === '7') {
        return new HttpsError('permission-denied', 'Ödeme verilerine erişim izni bulunamadı.');
    }

    if (rawCode.includes('unavailable') || rawCode === '14') {
        return new HttpsError('unavailable', 'Ödeme servisi geçici olarak kullanılamıyor.');
    }

    if (/index/i.test(rawMessage) && /create/i.test(rawMessage)) {
        return new HttpsError('failed-precondition', 'Ödeme sorgusu için gerekli Firestore indexi eksik veya hazır değil.');
    }

    return new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
}

function normalizeLimit(rawLimit: unknown): number {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed)) {
        return 50;
    }
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function normalizeStartAfterTimestamp(rawValue: unknown): number | undefined {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return undefined;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HttpsError(
            'invalid-argument',
            'startAfterTimestamp geçersiz. Milisaniye cinsinden pozitif bir değer gönderin.'
        );
    }

    return Math.trunc(parsed);
}

function getCreatedAtMillis(value: unknown): number {
    if (value && typeof (value as any).toMillis === 'function') {
        return (value as any).toMillis();
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function mapDocWithId(doc: FirebaseFirestore.QueryDocumentSnapshot): FirebaseFirestore.DocumentData {
    return {
        ...doc.data(),
        id: doc.id,
    };
}

// Firestore 'in' operatörü max 10 eleman destekler — büyük listeler için chunk'lara bölüp paralel sorgu yap
async function queryByGymIds(
    gymIds: string[],
    options: QueryByGymIdsOptions
): Promise<PaymentQueryResult> {
    const { status, limit, startAfterTimestamp } = options;

    const chunkSize = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < gymIds.length; i += chunkSize) {
        chunks.push(gymIds.slice(i, i + chunkSize));
    }

    const cursorTimestamp =
        startAfterTimestamp !== undefined
            ? admin.firestore.Timestamp.fromMillis(startAfterTimestamp)
            : null;

    const snapshots = await Promise.all(
        chunks.map((chunk) => {
            let q = db.collection(COLLECTIONS.PAYMENT_REQUESTS)
                .where('gymId', 'in', chunk) as FirebaseFirestore.Query;
            if (status) q = q.where('status', '==', status);
            q = q.orderBy('createdAt', 'desc');

            if (cursorTimestamp) {
                q = q.startAfter(cursorTimestamp);
            }

            q = q.limit(limit);
            return q.get();
        })
    );

    const docs: FirebaseFirestore.DocumentData[] = [];
    const seenIds = new Set<string>();
    snapshots.forEach((snap) => {
        snap.docs.forEach((doc) => {
            if (!seenIds.has(doc.id)) {
                seenIds.add(doc.id);
                docs.push(mapDocWithId(doc));
            }
        });
    });

    docs.sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));

    const pagedDocs = docs.slice(0, limit);
    const hasMore = docs.length > limit || snapshots.some((snap) => snap.size === limit);
    const lastTimestamp =
        pagedDocs.length > 0
            ? getCreatedAtMillis(pagedDocs[pagedDocs.length - 1].createdAt)
            : null;

    return {
        docs: pagedDocs,
        hasMore,
        lastTimestamp,
    };
}

export const getPaymentRequests = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student' && role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem için uygun rol yetkisi gereklidir.');
    }

    const data = (request.data ?? {}) as GetPaymentRequestsData;
    const { status, gymId } = data;

    const limit = normalizeLimit(data.limit);
    const startAfterTimestamp = normalizeStartAfterTimestamp(data.startAfterTimestamp);

    try {
        let rawDocs: FirebaseFirestore.DocumentData[] = [];
        let hasMore = false;
        let lastTimestamp: number | null = null;

        if (role === 'student') {
            // Öğrenci yalnızca kendi ödeme taleplerini görüntüleyebilir.
            const snapshot = await db.collection(COLLECTIONS.PAYMENT_REQUESTS)
                .where('studentId', '==', request.auth.uid)
                .get();

            rawDocs = snapshot.docs.map((doc) => mapDocWithId(doc));
            if (status) {
                rawDocs = rawDocs.filter((d) => d.status === status);
            }
            rawDocs.sort((a, b) => {
                const aMs = getCreatedAtMillis(a?.createdAt);
                const bMs = getCreatedAtMillis(b?.createdAt);
                return bMs - aMs;
            });

            if (startAfterTimestamp !== undefined) {
                rawDocs = rawDocs.filter((doc) => getCreatedAtMillis(doc.createdAt) < startAfterTimestamp);
            }

            hasMore = rawDocs.length > limit;
            rawDocs = rawDocs.slice(0, limit);
            lastTimestamp =
                rawDocs.length > 0
                    ? getCreatedAtMillis(rawDocs[rawDocs.length - 1].createdAt)
                    : null;

        } else if (role === 'coach') {
            const coachGymId = typeof request.auth.token.gymId === 'string' ? request.auth.token.gymId : '';
            if (!coachGymId) {
                throw new HttpsError('failed-precondition', 'Gym claim bilgisi eksik. Lütfen tekrar giriş yapın.');
            }
            const result = await queryByGymIds([coachGymId], {
                status,
                limit,
                startAfterTimestamp,
            });
            rawDocs = result.docs;
            hasMore = result.hasMore;
            lastTimestamp = result.lastTimestamp;

        } else if (role === 'admin') {
            const adminGymIds: string[] = request.auth.token.gymIds || [];

            if (adminGymIds.length === 0) {
                return {
                    success: true,
                    paymentRequests: [],
                    count: 0,
                    hasMore: false,
                    nextCursor: null,
                    lastTimestamp: null,
                };
            }

            if (gymId) {
                if (!adminGymIds.includes(gymId)) {
                    throw new HttpsError('permission-denied', 'Bu salona erişim yetkiniz yok.');
                }
                const result = await queryByGymIds([gymId], {
                    status,
                    limit,
                    startAfterTimestamp,
                });
                rawDocs = result.docs;
                hasMore = result.hasMore;
                lastTimestamp = result.lastTimestamp;
            } else {
                const result = await queryByGymIds(adminGymIds, {
                    status,
                    limit,
                    startAfterTimestamp,
                });
                rawDocs = result.docs;
                hasMore = result.hasMore;
                lastTimestamp = result.lastTimestamp;
            }

        } else {
            // superadmin: tüm ödeme talepleri (cursor + limit)
            let q = db.collection(COLLECTIONS.PAYMENT_REQUESTS) as FirebaseFirestore.Query;
            if (status) q = q.where('status', '==', status);
            q = q.orderBy('createdAt', 'desc');
            if (startAfterTimestamp !== undefined) {
                q = q.startAfter(admin.firestore.Timestamp.fromMillis(startAfterTimestamp));
            }
            q = q.limit(limit);
            const snap = await q.get();
            rawDocs = snap.docs.map((doc) => mapDocWithId(doc));
            hasMore = snap.size === limit;
            lastTimestamp =
                rawDocs.length > 0
                    ? getCreatedAtMillis(rawDocs[rawDocs.length - 1].createdAt)
                    : null;
        }

        // Student enrichment: unique studentId'leri tek batch ile oku → N+1 kapat
        const uniqueStudentIds = [...new Set(
            rawDocs.map((d) => d.studentId).filter((id): id is string => typeof id === 'string' && id.length > 0)
        )];

        const studentMap: Record<string, { firstName: string; lastName: string; photoUrl: string | null }> = {};
        if (uniqueStudentIds.length > 0) {
            const refs = uniqueStudentIds.map((sid) => db.collection(COLLECTIONS.STUDENTS).doc(sid));
            const studentDocs = await db.getAll(...refs);
            studentDocs.forEach((doc) => {
                if (doc.exists) {
                    const s = doc.data()!;
                    studentMap[doc.id] = {
                        firstName: s.firstName || '',
                        lastName: s.lastName || '',
                        photoUrl: s.photoUrl || null
                    };
                }
            });
        }

        const paymentRequests = rawDocs.map((rawData) => {
            const data = serializeTimestamps(rawData) as Record<string, any>;
            const student = studentMap[data.studentId];
            const firstName = student?.firstName ?? '';
            const lastName = student?.lastName ?? '';

            return {
                ...data,
                // Frontend'e tutarlı tutar alanı sun
                amount: data.type === PaymentMethodType.PACKAGE
                    ? data.totalAmount
                    : data.monthlyAmount,
                // Student enrichment (N+1 önlemek için)
                studentFirstName: firstName,
                studentLastName: lastName,
                studentFullName: `${firstName} ${lastName}`.trim(),
                studentPhotoUrl: student?.photoUrl ?? null
            };
        });

        return {
            success: true,
            paymentRequests,
            count: paymentRequests.length,
            hasMore,
            nextCursor: hasMore ? lastTimestamp : null,
            lastTimestamp,
        };

    } catch (error: any) {
        void logError({
            functionName: 'getPaymentRequests',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { status, gymId, limit, startAfterTimestamp }
        });
        if (error instanceof HttpsError) throw error;
        throw mapUnexpectedPaymentError(error);
    }
});