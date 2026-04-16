import { HttpsError } from "firebase-functions/v2/https";

/**
 * In-memory rate limiter (per Cloud Function instance).
 * Cloud Functions maxInstances: 10 olduğu için her instance kendi
 * belleğinde kullanıcı başına istek sayısını takip eder.
 */

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Stale entry'leri temizle — her 1000 istek veya 5 dakikada bir
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanupStaleEntries(windowMs: number): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;

    for (const [key, entry] of rateLimitStore) {
        if (now - entry.windowStart > windowMs) {
            rateLimitStore.delete(key);
        }
    }
}

/**
 * Kullanıcının istek limitini kontrol eder.
 * Limit aşılırsa HttpsError fırlatır.
 *
 * @param uid - Kullanıcı ID
 * @param maxRequests - Pencere başına max istek (varsayılan: 30)
 * @param windowMs - Zaman penceresi ms (varsayılan: 60000 = 1 dakika)
 */
export function checkRateLimit(
    uid: string | undefined,
    maxRequests = 30,
    windowMs = 60000
): void {
    if (!uid) return; // Auth kontrolü fonksiyonun kendisinde yapılıyor

    const now = Date.now();
    const key = uid;
    const entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
        // Yeni pencere başlat
        rateLimitStore.set(key, { count: 1, windowStart: now });
        cleanupStaleEntries(windowMs);
        return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
        throw new HttpsError(
            'resource-exhausted',
            'Çok fazla istek gönderdiniz. Lütfen biraz bekleyip tekrar deneyin.'
        );
    }
}
