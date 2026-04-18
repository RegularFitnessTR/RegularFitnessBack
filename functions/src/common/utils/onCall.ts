import {
    onCall as _onCall,
    HttpsError,
    type CallableRequest,
    type CallableOptions,
} from "firebase-functions/v2/https";
import { checkRateLimit } from "./rateLimit";

type OnCallHandler<T> = (request: CallableRequest<T>) => any | Promise<any>;

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
export function onCall<T = any>(handler: OnCallHandler<T>): ReturnType<typeof _onCall>;
export function onCall<T = any>(
    options: CallableOptions<any>,
    handler: OnCallHandler<T>
): ReturnType<typeof _onCall>;
export function onCall<T = any>(
    optionsOrHandler: CallableOptions<any> | OnCallHandler<T>,
    maybeHandler?: OnCallHandler<T>
) {
    const handler: OnCallHandler<T> =
        typeof optionsOrHandler === "function" ? optionsOrHandler : (maybeHandler as OnCallHandler<T>);

    if (typeof handler !== "function") {
        throw new Error("onCall handler is required");
    }

    const wrappedHandler = async (request: CallableRequest<T>) => {
        if (request.auth) {
            checkRateLimit(request.auth.uid);
        }
        return handler(request);
    };

    if (typeof optionsOrHandler === "function") {
        return _onCall(wrappedHandler);
    }

    return _onCall(optionsOrHandler, wrappedHandler);
}

// Re-export for convenience
export { HttpsError };
