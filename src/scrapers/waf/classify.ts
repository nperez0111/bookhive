/// What a Goodreads page fetch actually told us.
///
/// One classifier for both the plain fetch and the token-solved fetch, so a
/// plain-path failure can never be mistaken for a solve failure.

export type FetchOutcome =
  /** `__NEXT_DATA__` is present — this is the book page, whatever the status. */
  | "page"
  /** AWS WAF generated this response. A solved token may get us through. */
  | "challenged"
  /** We cleared the WAF and Goodreads' own origin refused us. Solving cannot help. */
  | "origin_error"
  /** 2xx, past the WAF, but no `__NEXT_DATA__`. Dead id, or a page redesign. */
  | "no_next_data";

/** AWS WAF stamps every response it generates with this header (`challenge`,
 *  `captcha`, `block`) — the only reliable way to tell "still blocked" from
 *  "got through and the origin said no". */
export const WAF_ACTION_HEADER = "x-amzn-waf-action";

export function classifyFetch(
  status: number,
  wafAction: string | null,
  hasMarker: boolean,
): FetchOutcome {
  // The marker is proof we have the page; nothing else can override it.
  if (hasMarker) return "page";
  // A 202 alone is enough, even without the action header — CloudFront can
  // return an empty-bodied 202 with no action header.
  if (wafAction || status === 202) return "challenged";
  if (status >= 400) return "origin_error";
  return "no_next_data";
}
