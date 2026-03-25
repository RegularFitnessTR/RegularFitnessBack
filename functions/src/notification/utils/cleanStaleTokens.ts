
import { db, COLLECTIONS } from "../../common";

export const cleanStaleTokens = async (staleTokens: string[]): Promise<void> => {
    if (staleTokens.length === 0) return;

    const staleSet = new Set(staleTokens);
    const collections = [COLLECTIONS.STUDENTS, COLLECTIONS.COACHES, COLLECTIONS.ADMINS];

    // array-contains-any max 10 eleman alır — chunk gerekiyor
    const chunks: string[][] = [];
    for (let i = 0; i < staleTokens.length; i += 10) {
        chunks.push(staleTokens.slice(i, i + 10));
    }

    await Promise.all(
        collections.flatMap(col =>
            chunks.map(async chunk => {
                const snap = await db
                    .collection(col)
                    .where("fcmTokens", "array-contains-any",
                        chunk.map(token => ({ token }))
                    )
                    .get();

                if (snap.empty) return;

                const batch = db.batch();
                snap.docs.forEach(doc => {
                    const current: { token: string }[] = doc.data()?.fcmTokens ?? [];
                    const cleaned = current.filter(t => !staleSet.has(t.token));
                    if (cleaned.length !== current.length) {
                        batch.update(doc.ref, { fcmTokens: cleaned });
                    }
                });
                await batch.commit();
            })
        )
    );
};