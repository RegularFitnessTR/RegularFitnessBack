import {onCall} from "firebase-functions/v2/https";

export const ping = onCall(
  {
    enforceAppCheck: false, // Warmup için AppCheck gerekmez
    maxInstances: 10,
  },
  (_request) => {
    return {status: "warm", timestamp: Date.now()};
  }
);
