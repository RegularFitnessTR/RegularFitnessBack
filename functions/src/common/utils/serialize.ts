import * as admin from "firebase-admin";

/**
 * Firestore dokümanlarında yer alan tüm Timestamp değerlerini ISO 8601 string'e
 * çevirerek client'a (iOS/Web) tutarlı bir tarih formatı sunar.
 *
 * Neden: Firestore Timestamp doğrudan JSON'a çevrildiğinde
 * `{ _seconds, _nanoseconds }` olarak gider ve her client'ın ayrı parse akışı
 * gerekir. ISO 8601 string ile `new Date(iso)` veya `ISO8601DateFormatter` yeter.
 */
/**
 * Tek bir Timestamp / Date değerini ISO 8601 string'e çevirir.
 * Null/undefined gelirse null döner — response alanlarında kullanım için güvenli.
 */
export function toIso(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return null;
}

export function serializeTimestamps<T = any>(value: T): T {
    if (value === null || value === undefined) {
        return value;
    }

    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate().toISOString() as unknown as T;
    }

    if (value instanceof Date) {
        return value.toISOString() as unknown as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeTimestamps(item)) as unknown as T;
    }

    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            result[key] = serializeTimestamps(val);
        }
        return result as unknown as T;
    }

    return value;
}
