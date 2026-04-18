import {
    onCall as _onCall,
    HttpsError,
    type CallableRequest,
} from "firebase-functions/v2/https";
import { checkRateLimit } from "./rateLimit";
import { db } from "./firebase";
import { COLLECTIONS } from "../constants/collections";

function normalizeGymIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    const normalized = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return [...new Set(normalized)];
}

async function hydrateRoleGymClaims<T>(request: CallableRequest<T>): Promise<void> {
    if (!request.auth) {
        return;
    }

    const token = request.auth.token as Record<string, any>;
    const role = token.role;

    try {
        if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            token.gymIds = adminDoc.exists ? normalizeGymIds(adminDoc.data()?.gymIds) : [];
            return;
        }

        if (role === 'coach' || role === 'student') {
            const tokenGymId = typeof token.gymId === 'string' ? token.gymId.trim() : '';
            if (tokenGymId) {
                return;
            }

            const collectionName = role === 'coach' ? COLLECTIONS.COACHES : COLLECTIONS.STUDENTS;
            const userDoc = await db.collection(collectionName).doc(request.auth.uid).get();
            const profileGymId = userDoc.data()?.gymId;
            token.gymId = typeof profileGymId === 'string' ? profileGymId : '';
        }
    } catch (error) {
        // Claim hydration işlemi asıl business akışını kırmamalı.
        console.warn('[onCall] Gym claim hydrate uyarısı:', error);
    }
}

/**
 * Rate limiting dahil onCall wrapper.
 * Authenticated kullanıcılar için dakikada 30 istek limiti uygular.
 * Her Cloud Function instance'ı kendi belleğinde limiti takip eder.
 */
export function onCall<T = any>(
    handler: (request: CallableRequest<T>) => any | Promise<any>
) {
    return _onCall(async (request: CallableRequest<T>) => {
        if (request.auth) {
            checkRateLimit(request.auth.uid);
            await hydrateRoleGymClaims(request);
        }
        return handler(request);
    });
}

// Re-export for convenience
export { HttpsError };
