/**
 * **The one** "turn an unknown thrown value into something loggable".
 *
 * `catch (err)` gives `unknown`, so call sites kept re-deriving
 * `err instanceof Error ? err.message : String(err)` by hand, unbounded. Lives
 * in `lib/` rather than a Hono middleware module because scrapers, workers and
 * the XRPC router all need it too.
 */

/** Bound on any single logged string, so a deep stack can't dominate a log line. */
export const MAX_LOG_CHARS = 4000;

/** Bound any attacker- or dependency-controlled text before it lands in a log line. */
export function truncateForLog(text: string): string {
  return text.slice(0, MAX_LOG_CHARS);
}

/** The message of a thrown value, whatever it turned out to be. Bounded. */
export function errorMessage(err: unknown): string {
  return truncateForLog(err instanceof Error ? err.message : String(err));
}

export type ErrorPayload = {
  message: string;
  type: string;
  stack?: string;
  cause?: string;
};

/**
 * The structured `error` field of a wide event.
 *
 * `stack: false` for deliberate 4xx — an `AuthRequiredError` is control flow,
 * not a defect, and a stack on every one of them is noise. The XRPC router had
 * its own copy of this for exactly that reason; it had also quietly dropped
 * `cause`, so a wrapped fetch failure logged from `/xrpc/*` lost the underlying
 * reason that the same failure logged from a page route kept.
 */
export function toErrorPayload(
  err: unknown,
  { stack = true }: { stack?: boolean } = {},
): ErrorPayload {
  if (!(err instanceof Error)) {
    return { message: errorMessage(err), type: "Error" };
  }
  const cause =
    err.cause instanceof Error
      ? err.cause.message
      : typeof err.cause === "string"
        ? err.cause
        : null;
  return {
    message: err.message,
    type: err.name,
    ...(stack && err.stack ? { stack: truncateForLog(err.stack) } : {}),
    ...(cause != null ? { cause: truncateForLog(cause) } : {}),
  };
}
