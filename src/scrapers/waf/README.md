# Fetching Goodreads, and the AWS WAF solver

Goodreads protects book pages (`/book/show/*`) with AWS WAF bot detection. Most
of the time a plain server-side `fetch()` gets the page; occasionally it gets a
**202 response** containing a JavaScript challenge instead. This module fetches
the page, and solves the challenge without a browser when one shows up.

## Two operations, deliberately kept apart

|                                  | Fetch the page                    | Solve a challenge                              |
| -------------------------------- | --------------------------------- | ---------------------------------------------- |
| Cost                             | 1 request, ~200 ms                | ~4 requests, 1.3 MB script, a Worker, PoW      |
| Where                            | main thread (`solver.ts`)         | Bun Worker (`solver-worker.ts`)                |
| Historical success rate (August) | ~98%                              | 0% since 2026-08-01 in that investigation      |
| Bounded by                       | the enrich drain (36 fetches/min) | single-flight + one attempt per token lifetime |

Keeping them separate buys one property, and the file is arranged around it:

> **No book is ever failed without a request to Goodreads having been sent and
> answered.**

`fetchGoodreadsViaWaf` has no early-return branch before the fetch. Not "the
threshold is tuned so it rarely does" — there is no branch.

## Why there is no circuit breaker here

There used to be one. It was fed by _solve_ outcomes and gated the _page fetch_,
so when the WAF stopped honouring our tokens it sat open and refused the path
that still worked. Measured over one 6h window on 2026-08-03: **8,606 refusals
across 6,840 distinct books**, breaker open in 254 of 360 minutes — while the
requests it did allow through succeeded 95.6% of the time. Worse, `enrich_queue`
counted a refusal as an attempt, so **2,854 books (98% of everything the queue
gave up on) were tombstoned for 7 days apiece** without a packet leaving the box.

Nothing replaced it, because the three things it was protecting are each handled
better somewhere else:

- **Cost of pointless solves** — single-flight plus `SOLVE_MIN_INTERVAL_MS`, which
  is _derived_ from the token lifetime rather than tuned: solving more often than
  a token lasts cannot produce anything we don't already have. Worst case with
  every solve failing is 15 attempts/hour. The breaker, open 70% of the time,
  allowed 16.
- **Hammering Goodreads** — `ENRICH_CONCURRENCY`/`DRAIN_INTERVAL_MS` in
  `data/enrichQueue.ts` already cap us at 36 fetches/min whether Goodreads is
  healthy or dead, since a failing fetch is faster than a succeeding one. The
  breaker was a second limiter on an already-bounded path; all it changed was
  which books got destroyed.
- **Memory** (the 2026-08-01 OOM, ~148 cgroup kills in a month) — _tighter_ now.
  At most **one** solver Worker per process instead of a pool of four plus 32
  queued waiters, terminated on every path rather than retired after 50 solves,
  and page bodies no longer cross the Worker boundary at all.

A breaker is right when refusing is cheaper than failing — see
`auth/restore-guard.ts`, where a user is waiting. Enrichment has a better option:
`enrich_queue` can _defer_ a book without charging it an attempt.

## How a solve works

1. **Discover** — The main thread already fetched the challenge interstitial, and
   hands the HTML to the worker. It contains `window.gokuProps` (encrypted
   session params) and a `<script>` tag pointing to `challenge.js` on
   `*.token.awswaf.com`. No fetch is needed to discover the challenge.

2. **Extract crypto config** — Download `challenge.js` (~1.3 MB of obfuscated
   JS). `deobfuscate.ts` deobfuscates it by evaluating the string-rotation array
   and decoder function via `new Function()`, then brute-forces all 1,536
   string-table entries to find:
   - AES-256-GCM key (64 hex chars)
   - Signal identifier name (e.g. `"Zoey"`)
   - Signal version (e.g. `"2.4.0"`)

3. **Build fake browser signals** — Construct a fingerprint object mimicking
   Chrome on macOS: navigator, screen, GPU (WebGL), canvas hash, math constants,
   timezone, fonts, plugins, battery, stealth checks (`webdriver: false`).

4. **Encrypt signals** — AES-256-GCM with the extracted key. Format:
   `base64(nonce)::hex(tag)::hex(ciphertext)`.

5. **Read the inputs envelope and solve proof-of-work** — `challenge_type`,
   `difficulty` and optional `memory` are **outer `/inputs` fields**. The nested
   `challenge.input` is opaque signed data; never base64-decode it as JSON.
   `protocol.ts` validates the envelope and resolves only known exact type IDs.
   The October read-only probe returned the retained script's `NetworkBandwidth`
   type at difficulty 1, which requires POSTing a 1 KB zeroed buffer. Other WAF
   configurations may use `HashcashScrypt` or `SHA256` (brute-force nonce
   search); those paths are implemented but untested against Goodreads. Because
   the solve runs in the worker, even an expensive brute-force never blocks the
   main thread.

6. **POST solution** — Send the encrypted signals, PoW solution, metrics, and
   `gokuProps` to `{challengeBase}/mp_verify`. Receive an `aws-waf-token`.

The worker's job ends there. The main thread re-fetches the page with
`Cookie: aws-waf-token=<token>`, classifies the result the same way it classified
the first fetch, and caches the token only if it actually worked.

## Caching

State lives on the main thread (`solver.ts`) and is passed into the worker each
call; the worker returns updated values to fold back in.

- **Crypto config** is cached in memory keyed by the `challenge.js` URL. It only
  changes when Goodreads deploys a new challenge script (rare), so it's reused
  across solves.
- **WAF token** is cached for `TOKEN_MAX_AGE_MS` (4 minutes) and reused across
  all Goodreads pages. It is stored only after a fetch with it has succeeded, and
  dropped the moment one fails.

  > **The measured token lifetime is 300 s** — AWS WAF's default challenge
  > immunity time. Probed 2026-08-02: the same token was still accepted at 241 s
  > and was challenged again at 301 s. The cache window is deliberately set below
  > that; it was previously 10 minutes, so the back half of every window sent a
  > dead token and paid a full re-solve (4 requests instead of 1). No per-token
  > _use_ limit was observed — one token served 10 pages in ~30 s.

- On a cold start the full solve takes ~1.5-2 s. Subsequent requests reuse the
  cached token and are a single `fetch()` (~200 ms).

## Files

| File               | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `solver.ts`        | Page fetch, token cache, the solve decision. `fetchGoodreadsViaWaf()` |
| `solver-worker.ts` | Bun Worker: challenge → token, injectable fetch for offline tests     |
| `protocol.ts`      | Validated outer inputs envelope, exact dispatch IDs, bounded JSON     |
| `classify.ts`      | `classifyFetch()` — what a fetch actually told us                     |
| `http.ts`          | UA, headers and `boundedText` shared by both sides                    |
| `deobfuscate.ts`   | Deobfuscates challenge.js (imported by worker; CLI for testing)       |
| `messages.ts`      | Worker ⇄ client message contract                                      |
| `pageMarker.ts`    | `__NEXT_DATA__` marker shared with `moreInfo.ts`                      |

`http.ts` exists so the UA the page fetch sends and the fingerprint
`buildSignals(ua)` encrypts always describe the same browser. When each side had
its own copy, a change to one silently made the two disagree — exactly the sort
of mismatch AWS WAF scores against us.

The worker is bundled to `.output/server/workers/waf-solver-worker.js` by
`standaloneBundles()` in `vite.config.ts`. `solver.ts` loads that `.js` in the
Nitro build and the `.ts` source in dev (same pattern as `src/context.ts`).

## Reading the outcomes

Every fetch, plain or token-bearing, goes through `classifyFetch(status,
wafAction, hasMarker)`. The `x-amzn-waf-action` header is the load-bearing input:
it is present only on responses the WAF generated itself, which is the only
reliable way to tell "the WAF is still stopping us" from "we got through the WAF
and the origin said no" — the bodies of both are short non-`__NEXT_DATA__` HTML.

| `scrape_outcome` | Means                                    | What it does             |
| ---------------- | ---------------------------------------- | ------------------------ |
| `page`           | `__NEXT_DATA__` present                  | Done                     |
| `challenged`     | 202, or any WAF action header            | Try to solve, else defer |
| `origin_error`   | ≥400 with no WAF action — origin said no | Defer                    |
| `no_next_data`   | 2xx past the WAF, no marker              | Defer                    |

**`no_next_data` never means "the book is gone".** Only `moreInfo.ts` may
conclude that, because only it can see that `getBookByLegacyId` resolved to
`null` in the page's Apollo state. If AWS ever serves a challenge as a plain 200
without the action header, inferring "dead" from the fetch alone would tombstone
the entire 356k-book catalogue in four days. The classifier has no `dead` case at
all, by construction.

## Historical production failures (August 2026)

Solving worked from this host until 2026-07-29 — 5–30 successes/day, no token
failures. On **2026-07-30** volume spiked ~20× (284 solves + 1,150 cached-token
fetches) and `waf_token_ineffective` appeared the same day (2,430, then 14,397 on
07-31). The August investigation found **zero solve successes since 2026-08-01**.
That failure predates the code changes in #196/#197.

A/B on 2026-08-03, identical code, challenge forced via the `ua` seam, 4/4 each:

| From                 | initial       | after solve                                                             |
| -------------------- | ------------- | ----------------------------------------------------------------------- |
| Hetzner (production) | 202 challenge | **202 + `x-amzn-waf-action: challenge`** — token refused                |
| Residential IP       | 202 challenge | **403, no waf-action** — token accepted; origin refused the headless UA |

Both hosts got an identical challenge (`NetworkBandwidth`, difficulty 1) and both
downloaded `challenge.js` fine. Earlier, from a residential IP over ~450 requests:
sequential fetches were never challenged (0/40), challenges appeared only under
concurrency (4/12 at C=4, 10/20 at C=10, 7/24 at C=12), and **all 21 solved
successfully**.

That experiment supported a sound crypto path and an egress reputation problem
**at that time**, not a permanent guarantee that the protocol decoder is correct.
Plain fetches from the same box were healthy (12/12 at C=12 on 2026-08-03,
97.9% in that production window), which is why the paths must not share a fate.
Reputation may recover, so the solver stays and keeps making one cheap attempt
per token lifetime.

## October 2026: opaque input was incorrectly parsed as JSON

The October 25 audit contained 30 `scrape_solve` entries with a JSON parse error
on `\u05fd` (single-flight can repeat one attempt across multiple book events).
Those older events did not record a stage, so they cannot prove the precise
parse site. A read-only `/inputs?client=browser` GET returned HTTP 200 JSON with
outer `challenge_type`/`difficulty` and nested `challenge.input`/`region`.
Base64-decoding that input produced non-JSON bytes. The previous worker tried
to parse those bytes as JSON before doing any proof-of-work or verification.

The returned type ID,
`ha9faaffd31b4d5ede2a2e19d2d7fd525f66fee61911511960dcbb52d3c48ce25`,
also appears in the checked-in challenge script's dispatch table. Its solver
allocates a zeroed buffer using the bandwidth difficulty map (1 KiB through
10 MiB), then strips the FileReader data-URL prefix and returns raw base64,
establishing this **exact ID's** algorithm without assuming all opaque or hashed
types are bandwidth. The same fixture identifies the two hashcash
aliases in `protocol.ts`. Unknown IDs now return
`waf_unsupported_challenge_type`, not a guessed scrypt solution.

`/inputs` and verification responses have HTTP checks and a 64 KiB body limit.
Malformed JSON/shape, unsupported types and HTTP failures have separate stable
codes. `scrape_solve_diagnostics` carries stage/round, HTTP status, sanitized MIME,
body byte count, allowlisted type identifier and input length where available.
It never includes response bodies, challenge input, keys, tokens, signals or
gokuProps. Every solver failure still **defers** enrichment without charging a
book attempt, and the page-fetch-first and four-minute single-flight policies
are unchanged.

Offline tests validate dispatch, unchanged opaque-input submission and multipart
construction using synthetic fixtures. **No live verification POST or successful
token/page recovery was tested for this fix**; signal compatibility and current
egress reputation remain unproven. Do not attribute a decoder-stage failure to
the historical IP-reputation incident.

## If Goodreads changes challenge.js

The most likely breakage scenarios and how to fix them:

1. **New obfuscation pattern** — The regex that finds the string-array function
   (`a0_0x...`) or decoder function may not match. Update the regexes in
   `deobfuscate.ts`. Capture the new `challenge.js` into
   `__fixtures__/challenge-script.js` for offline testing.

2. **Different challenge type** — Check `scrape_solve_diagnostics.challengeType`.
   The named algorithms and exact fixture-backed aliases are supported; a new
   opaque ID must be traced to its script's solver before adding a mapping.
   Never guess an algorithm from the ID's appearance or decode signed input.

3. **New signal fields** — AWS WAF may require additional fingerprint signals.
   Compare `buildSignals()` in `solver-worker.ts` against what the real
   challenge.js collects (search for collector names in the decoded string
   table).

4. **Token format change** — The token is opaque; if the cookie name changes
   from `aws-waf-token`, update `fetchGoodreadsPage()` in `solver.ts`.

## Testing offline

```sh
# Capture a fresh challenge page and script
curl -sS -o __fixtures__/challenge-page.html "https://www.goodreads.com/book/show/27833670"
# Extract the challenge.js URL from the HTML, then:
curl -sS -o __fixtures__/challenge-script.js "<challenge.js URL>"

# Run deobfuscation standalone
bun run src/scrapers/waf/deobfuscate.ts __fixtures__/challenge-script.js

# Run the solver test suite
bun test src/scrapers/waf/
```
