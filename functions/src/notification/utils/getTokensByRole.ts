// notifications/utils/getTokensByRole.ts

import { db, COLLECTIONS } from "../../common";
import { UserRole } from "../../common/types/base";

const ROLE_COLLECTION: Record<string, string> = {
    student: COLLECTIONS.STUDENTS,
    coach: COLLECTIONS.COACHES,
    admin: COLLECTIONS.ADMINS,
    superadmin: COLLECTIONS.SUPERADMINS,
};

export interface TokenEntry {
    uid: string;
    token: string;
}

export const getTokensByRole = async (
    userIds: string[],
    role: UserRole
): Promise<TokenEntry[]> => {

    const collection = ROLE_COLLECTION[role];
    if (!collection || userIds.length === 0) return [];

    const refs = userIds.map(uid => db.collection(collection).doc(uid));
    const docs = await db.getAll(...refs);

    const result: TokenEntry[] = [];

    for (const doc of docs) {
        if (!doc.exists) continue;
        const tokens: { token: string }[] = doc.data()?.fcmTokens ?? [];
        for (const t of tokens) {
            if (t.token) result.push({ uid: doc.id, token: t.token });
        }
    }

    return result;
};