import {
    onCall as _onCall,
    HttpsError,
    type CallableRequest,
} from "firebase-functions/v2/https";
import { checkRateLimit } from "./rateLimit";

/**
 * Rate limiting dahil onCall wrapper.
 * Authenticated kullanıcılar için dakikada 30 istek limiti uygular.
 * Her Cloud Function instance'ı kendi belleğinde limiti takip eder.
 *
 * Not: gymId / gymIds custom claim'leri kayıt anında set edilir
 * (createAdmin / registerCoach / joinGym vb.) ve değişikliklerde
 * syncGymClaims ile güncellenir. Bu nedenle her request'te Firestore'dan
 * tekrar okumaya gerek yoktur. Client değişiklik sonrası ID token'ı
 * yenilemekle sorumludur (getIdToken(true)).
 */
export function onCall<T = any>(
    handler: (request: CallableRequest<T>) => any | Promise<any>
) {
    return _onCall(async (request: CallableRequest<T>) => {
        if (request.auth) {
            checkRateLimit(request.auth.uid);
        }
        return handler(request);
    });
}

// Re-export for convenience
export { HttpsError };
