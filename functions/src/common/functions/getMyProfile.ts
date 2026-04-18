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

async function resolveProfileByRoleClaim(uid: string, role: string) {
    const collection = ROLE_TO_COLLECTION[role];
    if (!collection) return null;
    const doc = await db.collection(collection).doc(uid).get();
    if (!doc.exists) return null;
    return { collection, role: role as 'admin' | 'coach' | 'student' | 'superadmin', doc };
}

export const getMyProfile = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const uid = request.auth.uid;
    const claimRole = typeof request.auth.token.role === 'string' ? request.auth.token.role : '';

    try {
        if (!claimRole || !(claimRole in ROLE_TO_COLLECTION)) {
            throw new HttpsError('failed-precondition', 'Token role claim bilgisi eksik veya geçersiz. Lütfen tekrar giriş yapın.');
        }

        const resolved = await resolveProfileByRoleClaim(uid, claimRole);

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
