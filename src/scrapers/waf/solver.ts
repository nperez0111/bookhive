/// Main-thread client for the AWS WAF solver worker.
///
/// Holds the small amount of cross-request state (the working token and the
/// extracted crypto config) and delegates all network I/O + CPU-bound solving to
/// `solver-worker.ts` so the main event loop is never blocked. Each call spawns a
/// short-lived worker, passes in the cached token/config, and folds whatever the
/// worker reports back into the cache.

import type { SerializedConfig, WafRequest, WafResult } from "./messages";

const TOKEN_MAX_AGE_MS = 10 * 60 * 1000;
const WORKER_TIMEOUT_MS = 60_000;

// When running the Nitro bundle (.output/server/index.mjs), load the pre-built
// worker. In dev, Bun runs the .ts source directly. Mirrors src/context.ts.
const isBundled = import.meta.url.includes(".output/");
const WORKER_URL = isBundled
  ? new URL("./workers/waf-solver-worker.js", import.meta.url).href
  : new URL("./solver-worker.ts", import.meta.url).href;

let cachedConfig: SerializedConfig | null = null;
let cachedChallengeJsUrl: string | null = null;
let cachedToken: { value: string; obtainedAt: number } | null = null;

function runWorker(req: WafRequest): Promise<WafResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("WAF solve timed out"));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WafResult>) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`WAF worker error: ${error.message}`));
    };

    worker.postMessage(req);
  });
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
    addCtx({
      scrape_url: url,
      scrape_failure: "waf_worker_error",
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

  return result.html;
}
