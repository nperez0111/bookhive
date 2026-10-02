/**
 * What one enrichment run learned **about a book**, as opposed to about us.
 *
 * `enrich_queue.attempts` counts answers from Goodreads, and only an answer may
 * spend one. This type is the one contract for that verdict, replacing an
 * untyped `enrich_retry` string written by hand at eight sites and read by
 * exactly one, with no type relationship between producers and consumer.
 */

export type EnrichVerdictKind =
  /** Goodreads answered and the answer was no good. Spends an attempt. */
  | "retry"
  /** We never got an answer — our side, the network, a WAF challenge. Free. */
  | "defer"
  /** Goodreads answered definitively that this book is gone. Terminal at once. */
  | "dead";

export type EnrichVerdict = { kind: EnrichVerdictKind; reason: string };

export const retryVerdict = (reason: string): EnrichVerdict => ({ kind: "retry", reason });
export const deferVerdict = (reason: string): EnrichVerdict => ({ kind: "defer", reason });
export const deadVerdict = (reason: string): EnrichVerdict => ({ kind: "dead", reason });

/**
 * The wide-event fields for a verdict — the one spelling of these two keys.
 *
 * They used to be set independently at every producer, so nothing enforced that
 * `enrich_retry` and `scrape_failure` described the same thing.
 */
export function verdictFields(verdict: EnrichVerdict): {
  enrich_retry: EnrichVerdictKind;
  scrape_failure: string;
} {
  return { enrich_retry: verdict.kind, scrape_failure: verdict.reason };
}

/**
 * Narrow a verdict back off the wide-event bag.
 *
 * **Defaults to `defer`, not `retry`.** A missing verdict means we never
 * learned anything about the book, which is what `defer` means — the old
 * `retry` default let a producer that forgot to declare one silently spend an
 * attempt. `MAX_QUEUE_AGE_MS` already bounds a permanently-deferring book, so
 * `retry` as a default bought nothing but the failure mode.
 */
export function verdictKindFrom(fields: Record<string, unknown>): EnrichVerdictKind {
  const value = fields["enrich_retry"];
  return value === "retry" || value === "dead" ? value : "defer";
}
