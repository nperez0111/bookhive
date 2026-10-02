/**
 * Guards OAuth session restore against unreachable PDSes.
 *
 * An unreachable PDS is normal and permanent-ish in a federated network, so
 * every restore is bounded by a timeout, and once a host has proven
 * unreachable, we stop dispatching to it until a cooldown elapses.
 */
import { CircuitBreaker } from "../lib/circuitBreaker";
import { withTimeout } from "../lib/semaphore";
import { errorMessage } from "../lib/errors";

// Deliberately far below the ~30s a user will tolerate — frees the lock and event loop rather than squeezing out a slow success.
export const RESTORE_TIMEOUT_MS = 5_000;

// Trips fast and recovers fast because refusing is cheaper for a waiting user than a 5s timeout on every page load — the opposite tradeoff from scraping (see `lib/circuitBreaker.ts`).
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
    // Prefer evicting an LRU *closed* breaker — an open one is load-bearing
    // and evicting it lets traffic straight back into a dead host. If every
    // breaker is open (a mass PDS outage), fall back to the overall LRU so
    // MAX_BREAKERS still holds; the replacement re-opens quickly and
    // guardedRestore's timeout still bounds every attempt meanwhile.
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
 * True when the session itself is dead and the user must log in again, rather
 * than their server just having a bad day. Everything not listed here is
 * treated as transient — getting this backwards silently logs users out on a
 * mere network timeout.
 */
export function isSessionTerminatingError(err: unknown): boolean {
  const message = errorMessage(err);
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
  /** Overrides `RESTORE_TIMEOUT_MS`; only tests set this, to avoid the real 5s wait. */
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
    // A revoked token is the PDS answering correctly — it says nothing about host health, so it must not count toward opening the breaker.
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
