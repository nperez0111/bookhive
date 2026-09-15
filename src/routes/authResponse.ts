import type { Context } from "hono";

import type { AppEnv } from "../context";

/**
 * **The one** JSON 401 body.
 *
 * The body deliberately carries every key its readers look for, since they
 * don't agree on which one to read: `bookApi.ts` treats `success === false`
 * as a failure even on a 2xx, the iOS uploader renders `error` verbatim, and
 * `code` is what a caller should branch on. Dropping any key would silently
 * break whichever client wanted it. The message is prose, not a bare code,
 * so it reaches already-installed builds with nothing shipped.
 */
export const UNAUTHENTICATED_MESSAGE = "Your session has expired. Sign in again to continue.";

export type AuthFailureBody = {
  success: false;
  code: "unauthenticated";
  error: string;
  message: string;
};

export function authFailureBody(message = UNAUTHENTICATED_MESSAGE): AuthFailureBody {
  return { success: false, code: "unauthenticated", error: message, message };
}

/** A JSON 401 for a route the client reads as JSON. */
export function jsonUnauthorized(c: Context<AppEnv>, message?: string) {
  return c.json(authFailureBody(message), 401);
}
