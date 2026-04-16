import { auth } from "./firebase";

/**
 * Mevcut custom claims'i koruyarak gymId veya gymIds alanını günceller.
 * Admin için gymIds (string[]), Coach için gymId (string) kullanılır.
 */
export async function syncGymClaims(
    uid: string,
    gymData: { gymId?: string } | { gymIds?: string[] }
): Promise<void> {
    const user = await auth.getUser(uid);
    const currentClaims = user.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...currentClaims, ...gymData });
}
