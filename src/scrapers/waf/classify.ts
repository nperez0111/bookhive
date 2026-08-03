/// What a Goodreads page fetch actually told us.
///
/// One classifier for *both* fetches — the plain one and the one made with a
/// solved token. Previously the plain fetch's outcome was inferred from a bare
/// `html.includes(NEXT_DATA_MARKER)` and only the token fetch got a real
/// classification, so a plain-path failure was indistinguishable from a solve
/// failure by the time it reached the caller. That is what let the solver's
/// failures take the plain path offline.

export type FetchOutcome =
  /** `__NEXT_DATA__` is present — this is the book page, whatever the status. */
  | "page"
  /** AWS WAF generated this response. A solved token may get us through. */
  | "challenged"
  /** We cleared the WAF and Goodreads' own origin refused us. Solving cannot help. */
  | "origin_error"
  /** 2xx, past the WAF, but no `__NEXT_DATA__`. Dead id, or a page redesign. */
  | "no_next_data";

/** AWS WAF stamps every response it generates itself with this header
 *  (`challenge`, `captcha`, `block`). Its presence is the only reliable way to
 *  tell "the WAF is still stopping us" from "we got through the WAF and the
 *  origin said no" — the bodies of both are short non-`__NEXT_DATA__` HTML. */
export const WAF_ACTION_HEADER = "x-amzn-waf-action";

export function classifyFetch(
  status: number,
  wafAction: string | null,
  hasMarker: boolean,
): FetchOutcome {
  // The marker is proof we have the page; nothing else can override it.
  if (hasMarker) return "page";
  // CloudFront returns an empty-bodied 202 when the request's Accept header
  // doesn't ask for text/html, so the status alone is enough even without the
  // action header.
  if (wafAction || status === 202) return "challenged";
  if (status >= 400) return "origin_error";
  return "no_next_data";
}
