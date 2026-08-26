/**
 * Guards OAuth session restore against unreachable PDSes.
 *
 * Why this exists (2026-08-02): `oauthClient.restore()` was called with no
 * timeout. When one user's PDS (`caramelo.social.br`) began blackholing packets
 * — TCP connect never completing, not refusing — the refresh hung while holding
 * the cross-process lock from PR #191, whose heartbeat renewed it so it was
 * never evicted as stale. Every other request for that DID, in every worker
 * process, then spun the lock's full poll budget, and each poll ran synchronous
 * SQLite statements on the event loop. Workers stopped calling `accept()`,
 * which is what Caddy recorded as 166,450 × `dial tcp: i/o timeout` — the
 * dominant 502 class of the 2026-08-01 outage.
 *
 * In a federated network an unreachable PDS is normal and permanent-ish. So:
 * bound every restore with a timeout, and once a host has proven unreachable,
 * stop dispatching to it at all until a cooldown elapses.
 */
import { CircuitBreaker } from "../utils/circuitBreaker";
import { withTimeout } from "../utils/semaphore";

/**
 * A healthy PDS answers a token refresh in well under a second. This is
 * deliberately far below the ~30s a user will tolerate: the point is to free
 * the lock and the event loop, not to squeeze out a slow success.
 */
export const RESTORE_TIMEOUT_MS = 5_000;

/**
 * Tuned for a path a user is waiting on: trip after a few failures rather than a
 * few dozen, and recover quickly enough that a PDS blip doesn't lock people out
 * for a quarter of an hour. Refusing here is cheaper for the user than eating a
 * 5s timeout on every page load, which is what makes a breaker the right shape
 * for this and the wrong shape for scraping (see `utils/circuitBreaker.ts`).
 */
const BREAKER_OPTIONS = {
  failureThreshold: 8,
  consecutiveFailureThreshold: 3,
  windowMs: 60_000,
  cooldownMs: 60_000,
  halfOpenMax: 1,
  successThreshold: 1,
} as const;

/** Distinct hosts tracked before the idle ones are pruned. */
export const MAX_BREAKERS = 512;

type Entry = { breaker: CircuitBreaker; lastUsedAt: number };

const breakers = new Map<string, Entry>();

function getBreaker(key: string): CircuitBreaker {
  const existing = breakers.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.breaker;
  }

  if (breakers.size >= MAX_BREAKERS) {
    // Prefer the least recently used *closed* breaker: an open one is
    // load-bearing, and evicting it lets traffic straight back into a dead
    // host. But preferring is not the same as requiring. If every breaker is
    // open or half-open — a mass PDS outage, which is exactly the scenario this
    // module exists for — then nothing is closed, nothing gets evicted, and the
    // map grows without bound. Fall back to the overall LRU so MAX_BREAKERS is
    // always enforced; the replacement re-opens after a few failures, and
    // guardedRestore's timeout still bounds every attempt in the meantime.
    let closedKey: string | null = null;
    let closedAt = Infinity;
    let anyKey: string | null = null;
    let anyAt = Infinity;
    for (const [k, entry] of breakers) {
      if (entry.lastUsedAt < anyAt) {
        anyAt = entry.lastUsedAt;
        anyKey = k;
      }
      if (entry.breaker.getState() !== "closed") continue;
      if (entry.lastUsedAt < closedAt) {
        closedAt = entry.lastUsedAt;
        closedKey = k;
      }
    }
    const evict = closedKey ?? anyKey;
    if (evict) breakers.delete(evict);
  }

  const breaker = new CircuitBreaker(BREAKER_OPTIONS);
  breakers.set(key, { breaker, lastUsedAt: Date.now() });
  return breaker;
}

/** Thrown instead of dispatching when the host's breaker is open. */
export class PdsUnavailableError extends Error {
  constructor(
    readonly host: string,
    readonly cooldownRemainingMs: number,
  ) {
    super(`PDS ${host} is unreachable; retrying in ${Math.ceil(cooldownRemainingMs / 1000)}s`);
    this.name = "PdsUnavailableError";
  }
}

/**
 * True when the failure means the session itself is dead and the user must log
 * in again, rather than that their server is having a bad day.
 *
 * Everything not listed here is treated as transient. Getting this backwards is
 * what silently logged users out during the incident: a network timeout hit the
 * same `session.destroy()` path as a revoked refresh token.
 */
export function isSessionTerminatingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /invalid_grant|invalid_client|unauthorized_client|invalid_token|revoked|token has expired/i.test(
    message,
  );
}

export type RestoreOutcome = {
  /** Host the breaker was keyed on — the DID when no session is stored yet. */
  key: string;
  state: "closed" | "open" | "half_open";
  durationMs: number;
};

/**
 * Run `restore` under a per-host circuit breaker and a hard timeout.
 *
 * `key` should be the authorization-server host (see
 * `getStoredSessionIssuerHost`) so that one dead PDS trips once for all of its
 * users, rather than each user paying the full failure budget separately.
 */
export async function guardedRestore<T>(
  key: string,
  restore: () => Promise<T>,
  onOutcome?: (outcome: RestoreOutcome) => void,
  /**
   * Overrides `RESTORE_TIMEOUT_MS`. Production never sets this; it exists so the
   * regression tests can exercise the same bounded-wait architecture without
   * sitting through a real 5 s timeout on every hung-restore case.
   */
  timeoutMs: number = RESTORE_TIMEOUT_MS,
): Promise<T> {
  const breaker = getBreaker(key);
  const startedAt = Date.now();

  if (!breaker.canRequest()) {
    const cooldown = breaker.cooldownRemainingMs();
    onOutcome?.({ key, state: "open", durationMs: 0 });
    throw new PdsUnavailableError(key, cooldown);
  }

  try {
    const result = await withTimeout(restore(), timeoutMs, `oauth restore for ${key}`);
    breaker.recordSuccess();
    onOutcome?.({ key, state: breaker.getState(), durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    // A revoked token is the PDS answering us correctly — it says nothing about
    // the host's health, so it must not count toward opening the breaker.
    if (isSessionTerminatingError(err)) {
      breaker.recordSuccess();
    } else {
      breaker.recordFailure();
    }
    onOutcome?.({ key, state: breaker.getState(), durationMs: Date.now() - startedAt });
    throw err;
  }
}

/** Test seam — drops all breaker state. */
export function resetRestoreGuards(): void {
  breakers.clear();
}

/** Current breaker states, for `/debug` and metrics. */
export function restoreGuardStates(): Array<{ key: string; state: string; cooldownMs: number }> {
  return [...breakers.entries()].map(([key, entry]) => ({
    key,
    state: entry.breaker.getState(),
    cooldownMs: entry.breaker.cooldownRemainingMs(),
  }));
}
