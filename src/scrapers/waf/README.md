# AWS WAF Solver for Goodreads

Goodreads protects book pages (`/book/show/*`) with AWS WAF bot detection.
Server-side `fetch()` gets a **202 response** containing a JavaScript challenge
instead of the actual page. This module solves the challenge without a browser.

All network I/O and CPU-bound work runs inside a **Bun Worker**
(`solver-worker.ts`), never on the main event loop. The main thread keeps a thin
client (`solver.ts`) that owns the cached token/config and hands the worker a URL
(plus any cached token/config); the worker fetches the page — solving the
challenge first if WAF is active — and returns the page HTML along with the
token/config that worked.

## How it works

1. **Fetch + discover** — The worker fetches the target URL (sending the cached
   `aws-waf-token` cookie if it has one). If the response is the real page, it's
   returned immediately. Otherwise the 202 body *is* the challenge page; it
   contains `window.gokuProps` (encrypted session params) and a `<script>` tag
   pointing to `challenge.js` on `*.token.awswaf.com`. No second fetch is needed
   to discover the challenge.

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

5. **Solve proof-of-work** — Goodreads currently uses `NetworkBandwidth`
   difficulty 1, which just requires POSTing a 1 KB zeroed buffer. Other WAF
   configurations may use `HashcashScrypt` or `SHA256` (brute-force nonce
   search); those paths are implemented but untested against Goodreads. Because
   the solve runs in the worker, even an expensive brute-force never blocks the
   main thread.

6. **POST solution** — Send the encrypted signals, PoW solution, metrics, and
   `gokuProps` to `{challengeBase}/mp_verify`. Receive an `aws-waf-token`.

7. **Re-fetch + return** — The worker re-fetches the page with
   `Cookie: aws-waf-token=<token>` and returns the HTML plus the working token
   and crypto config so the main thread can cache them.

## Caching

State lives on the main thread (`solver.ts`) and is passed into the worker each
call; the worker returns updated values to fold back in.

- **Crypto config** is cached in memory keyed by the `challenge.js` URL. It only
  changes when Goodreads deploys a new challenge script (rare), so it's reused
  across solves.
- **WAF token** is cached for 10 minutes and reused across all Goodreads pages.
  If a fetch with it fails, the worker re-solves and returns a fresh token; if a
  solve fails the cached token is dropped.
- On a cold start the full solve takes ~1.5-2 s. Subsequent requests reuse the
  cached token and are a single `fetch()` in the worker (~200 ms).

## Files

| File                | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `solver.ts`         | Main-thread client: `fetchGoodreadsViaWaf()`, token/config cache |
| `solver-worker.ts`  | Bun Worker: page fetch + full WAF solve (crypto, PoW, signals)   |
| `deobfuscate.ts`    | Deobfuscates challenge.js (imported by worker; CLI for testing)  |
| `messages.ts`       | Worker ⇄ client message contract                                |
| `pageMarker.ts`     | `__NEXT_DATA__` marker shared with `moreInfo.ts`                 |

The worker is bundled to `.output/server/workers/waf-solver-worker.js` by
`standaloneBundles()` in `vite.config.ts`. `solver.ts` loads that `.js` in the
Nitro build and the `.ts` source in dev (same pattern as `src/context.ts`).

## If Goodreads changes challenge.js

The most likely breakage scenarios and how to fix them:

1. **New obfuscation pattern** — The regex that finds the string-array function
   (`a0_0x...`) or decoder function may not match. Update the regexes in
   `deobfuscate.ts`. Capture the new `challenge.js` into
   `__fixtures__/challenge-script.js` for offline testing.

2. **Different challenge type** — If Goodreads switches from `NetworkBandwidth`
   to `HashcashScrypt` or `SHA256`, the solver already handles those. Check logs
   for `challenge_type` to confirm.

3. **New signal fields** — AWS WAF may require additional fingerprint signals.
   Compare `buildSignals()` in `solver-worker.ts` against what the real
   challenge.js collects (search for collector names in the decoded string
   table).

4. **Token format change** — The token is opaque; if the cookie name changes
   from `aws-waf-token`, update `fetchPage()` in `solver-worker.ts`.

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
