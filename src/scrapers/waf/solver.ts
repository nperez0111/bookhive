/// Main-thread client for the AWS WAF solver worker.
///
/// Holds the small amount of cross-request state (the working token and the
/// extracted crypto config) and delegates all network I/O + CPU-bound solving to
/// `solver-worker.ts` so the main event loop is never blocked.
///
/// Workers are **pooled and reused**. Previously every scrape spawned a fresh
/// Worker; under load that meant an unbounded number of JS VMs, each holding a
/// ~1.3 MB challenge.js plus fully-buffered page bodies, which is what grew
/// worker processes to ~2 GB and got them OOM-killed on 2026-08-01. With a pool,
/// memory is a function of pool size rather than request rate.
///
/// A circuit breaker sits in front: when Goodreads' WAF is rejecting our tokens
/// (5,297 `waf_token_ineffective` in 24h during the incident) we stop dispatching
/// entirely for a cooldown instead of re-solving from scratch on every request.

import type { SerializedConfig, WafRequest, WafResult } from "./messages";
import { CircuitBreaker } from "../../utils/circuitBreaker";
import { Semaphore, SemaphoreFullError, SemaphoreTimeoutError } from "../../utils/semaphore";

const TOKEN_MAX_AGE_MS = 10 * 60 * 1000;
const WORKER_TIMEOUT_MS = 30_000;

/** Concurrent solves. Memory scales with this; throughput does not need more —
 *  a cached-token fetch is ~200ms and arrivals were ~7.5/min during the outage. */
const SOLVER_POOL_SIZE = 4;
/** Retire a worker after this many solves so any slow heap growth is shed. */
const MAX_SOLVES_PER_WORKER = 50;
/** Callers queued behind a full pool before we shed load. */
const MAX_PENDING = 32;
/** How long a caller will wait for a free worker before giving up. */
const ACQUIRE_TIMEOUT_MS = 30_000;

// When running the Nitro bundle (.output/server/index.mjs), load the pre-built
// worker. In dev, Bun runs the .ts source directly. Mirrors src/context.ts.
const isBundled = import.meta.url.includes(".output/");
const WORKER_URL = isBundled
  ? new URL("./workers/waf-solver-worker.js", import.meta.url).href
  : new URL("./solver-worker.ts", import.meta.url).href;

let cachedConfig: SerializedConfig | null = null;
let cachedChallengeJsUrl: string | null = null;
let cachedToken: { value: string; obtainedAt: number } | null = null;

const breaker = new CircuitBreaker({
  failureThreshold: 10,
  consecutiveFailureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 15 * 60_000,
  halfOpenMax: 2,
  successThreshold: 2,
});

type PooledWorker = {
  worker: Worker;
  solves: number;
  /** Resolver for the request this worker is currently running, if any. */
  inFlight: { id: string; settle: (result: WafResult | Error) => void } | null;
};

const pool: PooledWorker[] = [];
const idleWorkers: PooledWorker[] = [];

const slots = new Semaphore(SOLVER_POOL_SIZE, {
  label: "waf_solver",
  maxPending: MAX_PENDING,
  acquireTimeoutMs: ACQUIRE_TIMEOUT_MS,
});

function retire(entry: PooledWorker): void {
  const poolIndex = pool.indexOf(entry);
  if (poolIndex !== -1) pool.splice(poolIndex, 1);
  const idleIndex = idleWorkers.indexOf(entry);
  if (idleIndex !== -1) idleWorkers.splice(idleIndex, 1);
  entry.worker.terminate();
}

function createWorker(): PooledWorker {
  const entry: PooledWorker = { worker: new Worker(WORKER_URL), solves: 0, inFlight: null };

  entry.worker.onmessage = (event: MessageEvent<WafResult>) => {
    const current = entry.inFlight;
    // Ignore replies for a request we already gave up on (timed out).
    if (!current || current.id !== event.data.id) return;
    entry.inFlight = null;
    current.settle(event.data);
  };

  entry.worker.onerror = (error) => {
    const current = entry.inFlight;
    entry.inFlight = null;
    retire(entry);
    current?.settle(new Error(`WAF worker error: ${error.message}`));
  };

  pool.push(entry);
  return entry;
}

function checkout(): PooledWorker {
  return idleWorkers.pop() ?? createWorker();
}

function checkin(entry: PooledWorker): void {
  if (!pool.includes(entry)) return; // already retired
  if (entry.solves >= MAX_SOLVES_PER_WORKER) {
    retire(entry);
    return;
  }
  idleWorkers.push(entry);
}

function runWorker(req: Omit<WafRequest, "id">): Promise<WafResult> {
  return slots.run(() => {
    const entry = checkout();
    const id = crypto.randomUUID();
    entry.solves++;

    return new Promise<WafResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        entry.inFlight = null;
        // A worker that blew its deadline may still be spinning — don't reuse it.
        retire(entry);
        reject(new Error("WAF solve timed out"));
      }, WORKER_TIMEOUT_MS);

      entry.inFlight = {
        id,
        settle: (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (result instanceof Error) {
            reject(result);
          } else {
            checkin(entry);
            resolve(result);
          }
        },
      };

      entry.worker.postMessage({ ...req, id } satisfies WafRequest);
    });
  });
}

/** Test/diagnostic helper: current pool occupancy. */
export function wafSolverStats() {
  return {
    workers: pool.length,
    idle: idleWorkers.length,
    active: slots.active,
    pending: slots.pending,
    circuit: breaker.getState(),
  };
}

/**
 * Fetch a Goodreads page, transparently solving AWS WAF if it's active. Returns
 * the page HTML, or null if it could not be obtained. `addCtx` receives
 * structured wide-event fields describing how the fetch went.
 */
export async function fetchGoodreadsViaWaf(
  url: string,
  addCtx: (context: Record<string, unknown>) => void,
): Promise<string | null> {
  if (!breaker.canRequest()) {
    addCtx({
      scrape_url: url,
      scrape_failure: "circuit_open",
      scrape_circuit_cooldown_ms: breaker.cooldownRemainingMs(),
    });
    return null;
  }

  const token =
    cachedToken && Date.now() - cachedToken.obtainedAt < TOKEN_MAX_AGE_MS
      ? cachedToken.value
      : null;

  let result: WafResult;
  try {
    result = await runWorker({
      url,
      token,
      config: cachedConfig,
      challengeJsUrl: cachedChallengeJsUrl,
    });
  } catch (error) {
    const overloaded =
      error instanceof SemaphoreFullError || error instanceof SemaphoreTimeoutError;
    // Shedding load is not evidence either way about Goodreads — we never sent
    // the request. Hand back the probe slot without counting it as a success,
    // which would otherwise let our own backpressure close the breaker.
    if (overloaded) {
      breaker.recordAbandoned();
    } else {
      breaker.recordFailure();
    }
    addCtx({
      scrape_url: url,
      scrape_failure: overloaded ? "solver_busy" : "waf_worker_error",
      scrape_error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Fold the worker's results back into the cache.
  if (result.config && result.challengeJsUrl) {
    cachedConfig = result.config;
    cachedChallengeJsUrl = result.challengeJsUrl;
  }
  if (result.token) {
    // Only restamp the age when the token actually changed, so a long-lived
    // token still expires from the cache and gets proactively re-solved.
    if (cachedToken?.value !== result.token) {
      cachedToken = { value: result.token, obtainedAt: Date.now() };
    }
  } else if (result.failure || result.error) {
    cachedToken = null;
  }

  addCtx({ scrape_url: url });
  if (result.status !== undefined) addCtx({ scrape_status: result.status });
  if (result.statusWithToken !== undefined) {
    addCtx({ scrape_status_with_token: result.statusWithToken });
  }
  if (result.method) addCtx({ scrape_method: result.method });
  if (result.failure) addCtx({ scrape_failure: result.failure });
  if (result.error) {
    addCtx({ scrape_failure: "waf_worker_error", scrape_error: result.error });
  }

  if (result.html) {
    breaker.recordSuccess();
  } else {
    breaker.recordFailure();
  }

  return result.html;
}
