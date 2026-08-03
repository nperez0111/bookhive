/** Message contract between the main-thread client (`solver.ts`) and the WAF
 *  solver worker (`solver-worker.ts`). All fields are structured-clone-safe.
 *
 *  The worker does one thing: turn a challenge page into an `aws-waf-token`. It
 *  does not fetch Goodreads pages — that happens on the main thread, so a page
 *  body is never copied across the boundary and a solver problem can never stop
 *  a page fetch from being attempted. */

export interface SerializedConfig {
  keyHex: string;
  identifier: string;
  signalVersion: string;
  challengeBaseUrl: string;
}

export interface WafRequest {
  /** Correlates the response with the request. */
  id: string;
  /** The challenge interstitial the main thread already fetched. The challenge
   *  URL and `gokuProps` are parsed out of it, so the worker never re-fetches
   *  the target page just to see the challenge again. */
  challengeHtml: string;
  /** Origin of the target page, e.g. `https://www.goodreads.com`. */
  site: string;
  /** Hostname of the target page — posted to the WAF as `domain`. */
  domain: string;
  /** Previously-extracted crypto config, to skip re-downloading challenge.js. */
  config: SerializedConfig | null;
  /** URL of the challenge.js the cached config was extracted from. */
  challengeJsUrl: string | null;
  /** The User-Agent the main thread used for the page fetch. Required: the
   *  fingerprint the worker encrypts must describe the same browser as the
   *  request that got challenged, and a default on each side lets the two drift. */
  ua: string;
}

export interface WafResult {
  /** Echoes `WafRequest.id`. */
  id: string;
  /** The solved `aws-waf-token`, or null if it could not be obtained. */
  token: string | null;
  /** Crypto config (possibly freshly extracted) for the caller to cache. */
  config: SerializedConfig | null;
  /** challenge.js URL the config corresponds to. */
  challengeJsUrl: string | null;
  /** Structured failure reason, surfaced to wide events. */
  failure?: string;
  /** Unexpected error message (thrown inside the worker). */
  error?: string;
}
