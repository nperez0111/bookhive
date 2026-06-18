# AWS WAF Solver for Goodreads

Goodreads protects book pages (`/book/show/*`) with AWS WAF bot detection.
Server-side `fetch()` gets a **202 response** containing a JavaScript challenge
instead of the actual page. This module solves the challenge without a browser.

## How it works

1. **Discover** — Fetch the target URL; get the 202 challenge page containing
   `window.gokuProps` (encrypted session params) and a `<script>` tag pointing
   to `challenge.js` on `*.token.awswaf.com`.

2. **Extract crypto config** — Download `challenge.js` (~1.3 MB of obfuscated
   JS). A Worker thread (`extract-worker.ts`) deobfuscates it by evaluating the
   string-rotation array and decoder function via `new Function()`, then brute-
   forces all 1,536 string-table entries to find:
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
   search); those paths are implemented but untested against Goodreads.

6. **POST solution** — Send the encrypted signals, PoW solution, metrics, and
   `gokuProps` to `{challengeBase}/mp_verify`. Receive an `aws-waf-token`.

7. **Use the token** — Set `Cookie: aws-waf-token=<token>` on subsequent
   `fetch()` requests. The token is reusable across all Goodreads pages.

## Caching

- **Crypto config** is cached in memory keyed by the `challenge.js` URL. It only
  changes when Goodreads deploys a new challenge script (rare).
- **WAF token** is cached for 10 minutes. When it expires (detected by a 202
  response), `moreInfo.ts` invalidates and re-solves.
- On a cold start the full solve takes ~1.5-2 s. Subsequent requests with a
  cached token are plain `fetch()` calls (~200 ms).

## Files

| File                | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `solver.ts`         | Public API: `getWafToken()`, `invalidateWafToken()` |
| `extract-config.ts` | Spawns `extract-worker.ts` in a Worker thread       |
| `extract-worker.ts` | Deobfuscates challenge.js (runs as Worker or CLI)   |

## If Goodreads changes challenge.js

The most likely breakage scenarios and how to fix them:

1. **New obfuscation pattern** — The regex that finds the string-array function
   (`a0_0x...`) or decoder function may not match. Update the regexes in
   `extract-worker.ts`. Capture the new `challenge.js` into
   `__fixtures__/challenge-script.js` for offline testing.

2. **Different challenge type** — If Goodreads switches from `NetworkBandwidth`
   to `HashcashScrypt` or `SHA256`, the solver already handles those. Check logs
   for `challenge_type` to confirm.

3. **New signal fields** — AWS WAF may require additional fingerprint signals.
   Compare `buildSignals()` in `solver.ts` against what the real challenge.js
   collects (search for collector names in the decoded string table).

4. **Token format change** — The token is opaque; if the cookie name changes
   from `aws-waf-token`, update `fetchGoodreadsPage()` in `moreInfo.ts`.

## Testing offline

```sh
# Capture a fresh challenge page and script
curl -sS -o __fixtures__/challenge-page.html "https://www.goodreads.com/book/show/27833670"
# Extract the challenge.js URL from the HTML, then:
curl -sS -o __fixtures__/challenge-script.js "<challenge.js URL>"

# Run extraction standalone
bun run src/scrapers/waf/extract-worker.ts __fixtures__/challenge-script.js

# Run the solver test suite
bun test src/scrapers/waf/
```
