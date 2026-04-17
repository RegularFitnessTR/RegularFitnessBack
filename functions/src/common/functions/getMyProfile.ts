import { db } from "../utils/firebase";
import { COLLECTIONS } from "../constants/collections";
import { onCall, HttpsError } from "../utils/onCall";
import { serializeTimestamps } from "../utils/serialize";
import { logError } from "../../log/utils/logError";

const PROFILE_RESOLUTION_ORDER = [
    { collection: COLLECTIONS.ADMINS, role: 'admin' as const },
    { collection: COLLECTIONS.COACHES, role: 'coach' as const },
    { collection: COLLECTIONS.STUDENTS, role: 'student' as const },
    { collection: COLLECTIONS.SUPERADMINS, role: 'superadmin' as const },
];

export const getMyProfile = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const uid = request.auth.uid;

    try {
        for (const entry of PROFILE_RESOLUTION_ORDER) {
            const doc = await db.collection(entry.collection).doc(uid).get();
            if (!doc.exists) {
                continue;
            }

            return {
                success: true,
                role: entry.role,
                collection: entry.collection,
                user: serializeTimestamps(doc.data())
            };
        }

        throw new HttpsError('not-found', 'Kullanıcı profili bulunamadı.');
    } catch (error: any) {
        await logError({
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
