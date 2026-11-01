/**
 * Recent sign-in: the password must have been typed just before.
 * The app checks the password by signing in again right before calling this function (since 0.7.6),
 * so the token carries a password sign-in from a few seconds ago in its `amr` claim. A stolen or
 * long-lived session (refreshed tokens keep the original sign-in time) can no longer delete the account.
 */

const RECENT_SIGN_IN_S = 10 * 60;

export function signedInRecently(payload: Record<string, unknown>, nowS: number): boolean {
  const amr = payload.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return method === "password" && typeof timestamp === "number" && nowS - timestamp <= RECENT_SIGN_IN_S;
  });
}
