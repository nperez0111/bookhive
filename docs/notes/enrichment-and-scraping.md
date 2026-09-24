# Enrichment & Scraping Notes

Background for `src/data/enrichQueue.ts`, `src/core/enrichVerdict.ts`, `src/services/searchBooks.ts`,
and `src/scrapers/waf/`. See also `src/scrapers/waf/README.md` for the full WAF incident account.

## Enrichment is queued, never inline

Routes call `enqueueEnrichment`/`enqueueEnrichmentBatch`. The primary worker drains the queue every
5s at concurrency 3, with exponential backoff. `enrichBookWithDetailedData` holds its own semaphore
(4) + 45s deadline. That drain interval × concurrency is also the **only** rate limit on requests
to Goodreads — 36 fetches/min, healthy or not. Don't add a second one.

## `enrich_queue.attempts` counts answers from Goodreads, not failures

A run reports a verdict in the wide-event bag: `retry` spends an attempt, `defer` costs nothing and
re-queues on a decaying schedule, `dead` tombstones the book immediately. Anything the app decided
on its own — a WAF challenge, a timeout, a transport error — is a `defer`. Getting this wrong is
expensive: when refusals counted as attempts, one 6h window wrote off 2,854 books for 7 days apiece
**without sending a single request on their behalf** (98% of everything the queue gave up on). The
bound on defers is `MAX_QUEUE_AGE_MS` (7d from `enqueuedAt`, which survives re-enqueue), not the
attempt counter.

**The verdict is a type, `core/enrichVerdict.ts`, not a string in a log bag.** It used to travel as
an untyped `enrich_retry` key written by hand at eight sites and read at exactly one, where the
type was declared and imported by nobody — eight producers and one consumer with no type
relationship, for the decision that caused the incident above. `verdictFields` is the one spelling
of the two wide-event keys. **The default is `defer`, not `retry`**: an omission used to spend an
attempt, which is exactly how the incident happened. The old argument for `retry` — "degrades to
bounded behaviour rather than looping for a week" — predates `MAX_QUEUE_AGE_MS`, which already ends
a permanently-deferring book at 7 days. The ceiling is there either way; `retry`-by-default only
bought the failure mode.

`enrich_queue`'s `exhausted` gauge counts `hive_book.enrichFailedAt` inside the cooldown window,
**not** queue rows at MAX_ATTEMPTS — those rows are deleted as they exhaust, so that read was
always 0. `deferred` counts books parked on something that isn't their fault; it replaced
`circuit_open` as the signal that fetching is in trouble.

## WAF solver: no circuit breaker, and adding one back is a regression

`waf/solver.ts` fetches the page on the main thread — always, with no gate of any kind — and only
hands a challenge off to `solver-worker.ts` if one actually comes back. The invariant:

> No book is ever failed without a request to Goodreads having been sent and answered.

There used to be a breaker fed by solve outcomes, gating the page fetch. When AWS WAF stopped
honouring our tokens it sat open and refused the path that still worked: 8,606 refusals across
6,840 books in one 6h window, breaker open 254 of 360 minutes, while the requests it did allow
through succeeded 95.6% of the time. The three things it protected are each handled better
elsewhere: solve cost by single-flight + one attempt per token lifetime
(`SOLVE_MIN_INTERVAL_MS`, derived from the measured 300s token validity); request rate by the
enrichment queue's concurrency/interval above; memory by at most one solver Worker per process,
terminated on every path. Full account in `src/scrapers/waf/README.md`.

`google.ts` and `isbndb.ts` are tracked but **not wired up** — nothing imports them and
`findBookDetails` has no fallback branch reaching them. Treat as reference material for a future
Goodreads-WAF fallback, not live code.

## `searchBooks` owns its own concurrency ceiling

It lives in `services/`, not at whichever route needed it first — `bsky/ingester.ts` and
`workers/import/logic.ts` both import it, so a Jetstream worker and a CSV import worker would
otherwise depend on the transport layer to define it. `refetchBooks` used to apply a `Semaphore` at
its own call site instead, so `POST /admin/refresh-user-books` fired a bare `void searchBooks(...)`
per book — 100 per page, recursing over a whole library with the promises dropped. That fan-out
shape caused the 2026-08-01 OOM kills. `warmCatalogSearch` is now the only spelling of
fire-and-forget catalogue warming, and it cannot be called unbounded.
