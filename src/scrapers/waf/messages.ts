/** Message contract between the main-thread client (`solver.ts`) and the WAF
 *  solver worker (`solver-worker.ts`). All fields are structured-clone-safe. */

export interface SerializedConfig {
  keyHex: string;
  identifier: string;
  signalVersion: string;
  challengeBaseUrl: string;
}

export interface WafRequest {
  /** Target Goodreads URL to fetch. */
  url: string;
  /** Previously-working `aws-waf-token`, if the caller has one cached. */
  token: string | null;
  /** Previously-extracted crypto config, to skip re-downloading challenge.js. */
  config: SerializedConfig | null;
  /** URL of the challenge.js the cached config was extracted from. */
  challengeJsUrl: string | null;
}

export interface WafResult {
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
  /** Status of the page fetch made with a freshly-solved token. */
  statusWithToken?: number;
  /** Structured failure reason, surfaced to wide events. */
  failure?: string;
  /** Unexpected error message (thrown inside the worker). */
  error?: string;
}
