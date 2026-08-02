/** Message contract between the main-thread client (`solver.ts`) and the WAF
 *  solver worker (`solver-worker.ts`). All fields are structured-clone-safe. */

export interface SerializedConfig {
  keyHex: string;
  identifier: string;
  signalVersion: string;
  challengeBaseUrl: string;
}

export interface WafRequest {
  /** Correlates the response with the request — workers are reused and serve
   *  requests one at a time, so a stale reply must never resolve a new caller. */
  id: string;
  /** Target Goodreads URL to fetch. */
  url: string;
  /** Previously-working `aws-waf-token`, if the caller has one cached. */
  token: string | null;
  /** Previously-extracted crypto config, to skip re-downloading challenge.js. */
  config: SerializedConfig | null;
  /** URL of the challenge.js the cached config was extracted from. */
  challengeJsUrl: string | null;
  /** Override the User-Agent used for both the page fetch and the fingerprint.
   *  Test seam only — production leaves this unset and the worker's own constant
   *  is used, so the request UA and the signals always describe one browser. */
  ua?: string;
}

export interface WafResult {
  /** Echoes `WafRequest.id`. */
  id: string;
  /** The fetched page HTML, or null if it could not be obtained. */
  html: string | null;
  /** The token that successfully fetched the page (may equal the input token). */
  token: string | null;
  /** Crypto config (possibly freshly extracted) for the caller to cache. */
  config: SerializedConfig | null;
  /** challenge.js URL the config corresponds to. */
  challengeJsUrl: string | null;
  /** How the page was obtained — surfaced to wide events. */
  method?: "plain_http" | "cached_token" | "waf_solver";
  /** Status of the first (pre-solve) page fetch. */
  status?: number;
  /** Status of the page fetch made with a freshly-solved token. Recorded on the
   *  failure path too — without it a `waf_token_ineffective` event is
   *  undiagnosable, which is why 5,297 of them on 2026-08-01 told us nothing. */
  statusWithToken?: number;
  /** `x-amzn-waf-action` on the token fetch. Present ⇒ the WAF itself generated
   *  that response (our token was rejected); absent ⇒ we cleared the WAF and the
   *  response came from Goodreads' origin. */
  wafActionWithToken?: string;
  /** Structured failure reason, surfaced to wide events. */
  failure?: string;
  /** Unexpected error message (thrown inside the worker). */
  error?: string;
}
