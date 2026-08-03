/// Fetching Goodreads pages, with AWS WAF handled when it gets in the way.
///
/// Two operations live here, and keeping them separate is the whole point of the
/// file:
///
///   1. **Fetch the page.** One plain GET on the main thread. Cheap (~200ms), and
///      it succeeds ~98% of the time. It is *always* attempted — there is no
///      breaker, no pool, no gate of any kind in front of it.
///   2. **Solve a WAF challenge.** ~4 requests, a 1.3 MB script download, a
///      Worker and proof-of-work. Only reached when (1) actually came back
///      challenged, and rate-limited to one solve per token lifetime.
///
/// The invariant this buys:
///
///   > No book is ever failed without a request to Goodreads having been sent
///   > and answered.
///
/// That used to be false. A single circuit breaker was fed by solve outcomes and
/// gated the page fetch, so when Goodreads' WAF stopped honouring our tokens the
/// breaker sat open and refused the path that still worked. Over one 6h window in
/// production that meant 8,606 refusals across 6,840 distinct books — and because
/// `enrich_queue` counted a refusal as an attempt, 2,854 books were written off
/// for 7 days without a single packet leaving the box. There is no circuit
/// breaker here now; see `README.md` for why nothing replaced it.
///
/// Solving is *currently* futile from this host: since 2026-08-01 AWS WAF has
/// refused every token minted from our egress IP (202 + `x-amzn-waf-action:
/// challenge` on the re-fetch), while the identical code from a residential IP
/// gets through. That is a reputation problem, not a crypto problem, and it may
/// recover — hence a cheap periodic attempt rather than deleting the solver.

import { classifyFetch, WAF_ACTION_HEADER, type FetchOutcome } from "./classify";
import { boundedText, MAX_PAGE_BYTES, navHeaders, UA } from "./http";
import { NEXT_DATA_MARKER } from "./pageMarker";
import type { SerializedConfig, WafRequest, WafResult } from "./messages";

/** AWS WAF's default immunity time is 300s, and Goodreads uses the default:
 *  a token measured live was still accepted at 241s and challenged again at
 *  301s. Cache for less than that — the previous 10 minutes meant the back half
 *  of every window sent a token that was already dead, paying a full cold solve
 *  to discover it. */
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;
const WORKER_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 15_000;

/** Minimum gap between solve attempts.
 *
 *  Derived, not tuned: a token is only good for a token lifetime, so solving
 *  more often than that cannot produce anything we don't already have. It is
 *  also the entire rate limit on the expensive path — worst case, with every
 *  solve failing, 15 attempts an hour. (The old breaker, open ~70% of the time,
 *  allowed 16.) */
const SOLVE_MIN_INTERVAL_MS = TOKEN_MAX_AGE_MS;

// When running the Nitro bundle (.output/server/index.mjs), load the pre-built
// worker. In dev, Bun runs the .ts source directly. Mirrors src/context.ts.
const isBundled = import.meta.url.includes(".output/");
const WORKER_URL = isBundled
  ? new URL("./workers/waf-solver-worker.js", import.meta.url).href
  : new URL("./solver-worker.ts", import.meta.url).href;

let cachedConfig: SerializedConfig | null = null;
let cachedChallengeJsUrl: string | null = null;
let cachedToken: { value: string; obtainedAt: number } | null = null;

let lastSolveAttemptAt = 0;
let lastSolveOutcome: string | null = null;

/** Why we don't have a token for this challenge — or that we do. */
type SolveResult = { token: string; reason: "solved" } | { token: null; reason: string };

/** The one and only in-flight solve. Concurrent challenged fetches await this
 *  rather than each spawning a Worker — which is also the memory bound that
 *  replaced the old pool + semaphore. Never more than one solver Worker alive
 *  per process; the pool allowed four plus 32 queued waiters. */
let solveInFlight: Promise<SolveResult> | null = null;

export type PageFetch = {
  outcome: FetchOutcome;
  html: string;
  status: number;
};

/** Overrides for tests and for the bastion-vs-residential reproduction probe.
 *  `ua` applies to the page fetch *and* the fingerprint the solver encrypts, so
 *  the two always describe one browser. */
export type WafFetchOptions = {
  fetchImpl?: typeof fetch;
  ua?: string;
  /** Stand in for the solver Worker. Tests use this to exercise the decision
   *  layer without spawning a VM or touching the network. */
  solveImpl?: SolveFn;
};

export type SolveFn = (req: Omit<WafRequest, "id">) => Promise<WafResult>;

/** Fetch a Goodreads page and say what came back. No gate, no worker, no state. */
export async function fetchGoodreadsPage(
  url: string,
  token: string | null,
  { fetchImpl = fetch, ua = UA }: WafFetchOptions = {},
): Promise<PageFetch> {
  const headers = navHeaders(ua);
  if (token) headers["cookie"] = `aws-waf-token=${token}`;

  const resp = await fetchImpl(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  const html = await boundedText(resp, MAX_PAGE_BYTES, "page_fetch");

  return {
    outcome: classifyFetch(
      resp.status,
      resp.headers.get(WAF_ACTION_HEADER),
      html.includes(NEXT_DATA_MARKER),
    ),
    html,
    status: resp.status,
  };
}

/** Run one solve in a throwaway Worker. The Worker is terminated on every path —
 *  a solve that blew its deadline may still be spinning, and a fresh VM per
 *  solve is how heap growth is shed now that workers aren't pooled. */
function runSolveWorker(req: Omit<WafRequest, "id">): Promise<WafResult> {
  const worker = new Worker(WORKER_URL);
  const id = crypto.randomUUID();

  return new Promise<WafResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("WAF solve timed out"))),
      WORKER_TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent<WafResult>) => {
      if (event.data.id !== id) return;
      finish(() => resolve(event.data));
    };
    worker.onerror = (error) => {
      finish(() => reject(new Error(`WAF worker error: ${error.message}`)));
    };

    worker.postMessage({ ...req, id } satisfies WafRequest);
  });
}

/**
 * Get a token for a challenge we just received, or null if we shouldn't try.
 *
 * Single-flight plus one attempt per token lifetime. Both are structural: there
 * is no threshold to tune and no probe accounting to leak, and the first
 * challenged fetch after Goodreads starts honouring our tokens again just works.
 */
function ensureWafToken(
  challengeHtml: string,
  url: string,
  ua: string,
  solve: SolveFn,
): Promise<SolveResult> {
  if (solveInFlight) return solveInFlight;
  if (Date.now() - lastSolveAttemptAt < SOLVE_MIN_INTERVAL_MS) {
    return Promise.resolve({ token: null, reason: "skipped" });
  }

  lastSolveAttemptAt = Date.now();
  const target = new URL(url);

  const inFlight: Promise<SolveResult> = solve({
    challengeHtml,
    site: target.origin,
    domain: target.hostname,
    config: cachedConfig,
    challengeJsUrl: cachedChallengeJsUrl,
    ua,
  })
    .then((result): SolveResult => {
      if (result.config && result.challengeJsUrl) {
        cachedConfig = result.config;
        cachedChallengeJsUrl = result.challengeJsUrl;
      }
      if (result.token) return { token: result.token, reason: "solved" };
      return { token: null, reason: result.failure ?? result.error ?? "no_token" };
    })
    .catch(
      (error): SolveResult => ({
        token: null,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((outcome) => {
      lastSolveOutcome = outcome.reason;
      if (solveInFlight === inFlight) solveInFlight = null;
      return outcome;
    });

  solveInFlight = inFlight;
  return inFlight;
}

/** Diagnostic helper: current solver state. */
export function wafSolverStats() {
  return {
    solving: solveInFlight !== null,
    tokenAgeMs: cachedToken ? Date.now() - cachedToken.obtainedAt : null,
    lastSolveAt: lastSolveAttemptAt || null,
    lastSolveOutcome,
  };
}

/** Test seam — drops all cross-request state. */
export function __resetSolverState(): void {
  cachedConfig = null;
  cachedChallengeJsUrl = null;
  cachedToken = null;
  lastSolveAttemptAt = 0;
  lastSolveOutcome = null;
  solveInFlight = null;
}

/**
 * Fetch a Goodreads page, solving AWS WAF if it's in the way. Returns the page
 * HTML, or null if it could not be obtained. `addCtx` receives structured
 * wide-event fields describing how the fetch went, including `enrich_retry`,
 * which tells `enrich_queue` whether this counts as an answer about the book.
 */
export async function fetchGoodreadsViaWaf(
  url: string,
  addCtx: (context: Record<string, unknown>) => void,
  options: WafFetchOptions = {},
): Promise<string | null> {
  addCtx({ scrape_url: url });

  const token =
    cachedToken && Date.now() - cachedToken.obtainedAt < TOKEN_MAX_AGE_MS
      ? cachedToken.value
      : null;

  let first: PageFetch;
  try {
    first = await fetchGoodreadsPage(url, token, options);
  } catch (error) {
    // Transport failure — DNS, connect, the 15s abort, an oversized body. Says
    // nothing about this book, so it must not consume a retry attempt.
    addCtx({
      scrape_failure: "fetch_failed",
      scrape_error: error instanceof Error ? error.message : String(error),
      enrich_retry: "defer",
    });
    return null;
  }

  addCtx({
    scrape_status: first.status,
    scrape_outcome: first.outcome,
    scrape_token: token ? "cached" : "none",
  });

  if (first.outcome === "page") return first.html;

  if (first.outcome !== "challenged") {
    // Past the WAF, but not the page we wanted. `no_next_data` might be a dead
    // book id — but only the parser, which can see that `getBookByLegacyId`
    // resolved to null, is allowed to conclude that. Guessing it from the fetch
    // alone would tombstone the whole catalogue the day Goodreads redesigns.
    addCtx({ scrape_failure: first.outcome, enrich_retry: "defer" });
    return null;
  }

  // The WAF challenged us and the body we just fetched *is* the challenge page.
  // If we sent a cached token to get here, it is dead ahead of its nominal
  // expiry — drop it now rather than spending the rest of the window proving it.
  if (token && cachedToken?.value === token) cachedToken = null;

  const solve = await ensureWafToken(
    first.html,
    url,
    options.ua ?? UA,
    options.solveImpl ?? runSolveWorker,
  );
  if (!solve.token) {
    addCtx({
      scrape_failure: "waf_challenged",
      scrape_solve: solve.reason,
      enrich_retry: "defer",
    });
    return null;
  }

  let second: PageFetch;
  try {
    second = await fetchGoodreadsPage(url, solve.token, options);
  } catch (error) {
    cachedToken = null;
    addCtx({
      scrape_failure: "fetch_failed",
      scrape_error: error instanceof Error ? error.message : String(error),
      enrich_retry: "defer",
    });
    return null;
  }

  addCtx({
    scrape_status_with_token: second.status,
    scrape_outcome: second.outcome,
    scrape_token: "fresh",
  });

  if (second.outcome === "page") {
    cachedToken = { value: solve.token, obtainedAt: Date.now() };
    return second.html;
  }

  // `challenged` here means the WAF refused a token it just issued us — the
  // failure mode this host has been in since 2026-08-01. Anything else means we
  // cleared the WAF and the origin said no. Neither is worth another solve now.
  cachedToken = null;
  addCtx({
    scrape_failure: second.outcome === "challenged" ? "waf_token_rejected" : second.outcome,
    enrich_retry: "defer",
  });
  return null;
}
