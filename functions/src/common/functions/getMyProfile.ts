import { db } from "../utils/firebase";
import { COLLECTIONS } from "../constants/collections";
import { onCall, HttpsError } from "../utils/onCall";
import { serializeTimestamps } from "../utils/serialize";
import { logError } from "../../log/utils/logError";

const ROLE_TO_COLLECTION: Record<string, string> = {
    admin: COLLECTIONS.ADMINS,
    coach: COLLECTIONS.COACHES,
    student: COLLECTIONS.STUDENTS,
    superadmin: COLLECTIONS.SUPERADMINS,
};

// Role claim eksik / geçersiz olduğunda fallback için: tüm collection'ları paralel kontrol et.
const FALLBACK_RESOLUTION_ORDER = [
    { collection: COLLECTIONS.ADMINS, role: 'admin' as const },
    { collection: COLLECTIONS.COACHES, role: 'coach' as const },
    { collection: COLLECTIONS.STUDENTS, role: 'student' as const },
    { collection: COLLECTIONS.SUPERADMINS, role: 'superadmin' as const },
];

async function resolveProfileByRoleClaim(uid: string, role: string) {
    const collection = ROLE_TO_COLLECTION[role];
    if (!collection) return null;
    const doc = await db.collection(collection).doc(uid).get();
    if (!doc.exists) return null;
    return { collection, role: role as 'admin' | 'coach' | 'student' | 'superadmin', doc };
}

async function resolveProfileFallback(uid: string) {
    // Role claim yoksa veya yanlışsa: tüm collection'ları paralel okuyup ilk match'i al.
    // Sıralı for-loop'a göre çok daha hızlı (4 RPC sequential → 1 RPC parallel duration).
    const results = await Promise.all(
        FALLBACK_RESOLUTION_ORDER.map((entry) =>
            db.collection(entry.collection).doc(uid).get()
                .then((doc) => ({ entry, doc }))
                .catch(() => null)
        )
    );
    for (const result of results) {
        if (result && result.doc.exists) {
            return { collection: result.entry.collection, role: result.entry.role, doc: result.doc };
        }
    }
    return null;
}

export const getMyProfile = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const uid = request.auth.uid;
    const claimRole = typeof request.auth.token.role === 'string' ? request.auth.token.role : '';

    try {
        // Önce JWT claim'deki role'e göre tek doğrudan lookup dene.
        // Eski (claim'siz) kullanıcılar için fallback'e düş.
        let resolved = claimRole ? await resolveProfileByRoleClaim(uid, claimRole) : null;
        if (!resolved) {
            resolved = await resolveProfileFallback(uid);
        }

        if (!resolved) {
            throw new HttpsError('not-found', 'Kullanıcı profili bulunamadı.');
        }

        const { collection, role, doc } = resolved;
        const user: any = serializeTimestamps(doc.data());

        // Student için gym + coach enrichment'ı paralel yap; coach için sadece gym.
        if (role === 'student') {
            const gymId = user?.gymId;
            const coachId = user?.coachId;

            const [gymDoc, coachDoc] = await Promise.all([
                gymId
                    ? db.collection(COLLECTIONS.GYMS).doc(gymId).get().catch(() => null)
                    : Promise.resolve(null),
                coachId
                    ? db.collection(COLLECTIONS.COACHES).doc(coachId).get().catch(() => null)
                    : Promise.resolve(null),
            ]);

            if (gymId) {
                user.gymName = gymDoc?.exists ? (gymDoc.data()?.name ?? null) : null;
            }
            if (coachId) {
                if (coachDoc?.exists) {
                    const c = coachDoc.data();
                    const full = [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim();
                    user.coachName = full.length > 0 ? full : null;
                } else {
                    user.coachName = null;
                }
            }
        } else if (role === 'coach') {
            const gymId = user?.gymId;
            if (gymId) {
                try {
                    const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
                    user.gymName = gymDoc.exists ? (gymDoc.data()?.name ?? null) : null;
                } catch {
                    user.gymName = null;
                }
            }
        }

        return {
            success: true,
            role,
            collection,
            user,
        };
    } catch (error: any) {
        void logError({
            functionName: 'getMyProfile',
            error,
            userId: uid,
            userRole: request.auth?.token?.role,
            requestData: {}
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'Profil bilgisi alınırken bir hata oluştu.');
    }
});
