import * as admin from "firebase-admin";

type TimestampPathToken = string | "[]" | "*";

interface SerializeOptions {
    timestampPaths?: string[];
}

// Yalnızca şemada bilinen timestamp path'lerini dönüştür.
const DEFAULT_TIMESTAMP_PATHS = [
    "createdAt",
    "updatedAt",
    "timestamp",
    "readAt",

    "birthDate",
    "measurementDate",
    "testDate",
    "clearanceDate",

    "assignedAt",
    "startDate",
    "endDate",
    "commitmentEndsAt",
    "date",

    "completedAt",
    "postponedAt",
    "postponedFrom",
    "cancelledAt",

    "checkedInAt",
    "checkedOutAt",
    "processedAt",

    "dueDate",
    "paidDate",
    "monthlyPayments.[].dueDate",
    "monthlyPayments.[].paidDate",

    "details.*",
    "payload.*",
] as const;

const DEFAULT_COMPILED_PATHS: TimestampPathToken[][] = DEFAULT_TIMESTAMP_PATHS.map((path) =>
    compilePath(path)
);

function compilePath(path: string): TimestampPathToken[] {
    return path
        .split('.')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => {
            if (segment === '[]' || segment === '*') {
                return segment;
            }
            return segment;
        });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof admin.firestore.Timestamp)
    );
}

function applyPath(value: unknown, path: TimestampPathToken[], index: number): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    if (index >= path.length) {
        const iso = toIso(value);
        return iso ?? value;
    }

    const token = path[index];

    if (token === '[]') {
        if (!Array.isArray(value)) {
            return value;
        }

        let changed = false;
        const mapped = value.map((item) => {
            const nextItem = applyPath(item, path, index + 1);
            if (nextItem !== item) {
                changed = true;
            }
            return nextItem;
        });

        return changed ? mapped : value;
    }

    if (token === '*') {
        if (!isPlainObject(value)) {
            return value;
        }

        let changed = false;
        const nextObject: Record<string, unknown> = {};

        for (const [key, child] of Object.entries(value)) {
            const nextChild = applyPath(child, path, index + 1);
            nextObject[key] = nextChild;
            if (nextChild !== child) {
                changed = true;
            }
        }

        return changed ? nextObject : value;
    }

    if (!isPlainObject(value) || !(token in value)) {
        return value;
    }

    const currentChild = value[token];
    const nextChild = applyPath(currentChild, path, index + 1);

    if (nextChild === currentChild) {
        return value;
    }

    return {
        ...value,
        [token]: nextChild,
    };
}

function serializeWithPaths<T>(value: T, paths: TimestampPathToken[][]): T {
    if (value === null || value === undefined) {
        return value;
    }

    const directIso = toIso(value);
    if (directIso !== null) {
        return directIso as unknown as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeWithPaths(item, paths)) as unknown as T;
    }

    let next: unknown = value;
    for (const path of paths) {
        next = applyPath(next, path, 0);
    }

    return next as T;
}

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

export function serializeTimestamps<T = any>(value: T, options: SerializeOptions = {}): T {
    const paths = options.timestampPaths?.length
        ? options.timestampPaths.map((path) => compilePath(path))
        : DEFAULT_COMPILED_PATHS;

    return serializeWithPaths(value, paths);
}
