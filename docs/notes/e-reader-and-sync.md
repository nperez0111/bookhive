# E-Reader & Sync Notes

Background for `/opds`, `/kosync`, `streamPersonalBook`, and XRPC service auth — the surfaces an
e-reader or a third-party script talks to instead of a browser.

## `etag()` must never see a large or streamed body

It buffers the entire response in memory. `/library/books/*`, `/opds/books/*` and `/import` are
excluded **by prefix** in `src/app.ts` (`ETAG_EXCLUDED_PREFIXES`). `/import` is also mounted above
the middleware, but don't rely on that alone: its SSE stream never ends, so if a reorder ever let
the digest see it, imports would hang forever and look like an import bug rather than an etag one.

Because those routes skip `etag()`, **they must answer `If-None-Match` themselves** — the
middleware is what turns a validator into a 304; setting the header alone does nothing.
`streamPersonalBook` (`src/data/personalLibrary.ts`) takes the request's `If-None-Match` and
returns a 304 before it opens the file. Without it, an e-reader re-downloads every book on every
sync.

## `streamPersonalBook` owns range requests too

Nothing upstream will do it. OPDS, `/library`, and XRPC `getPersonalBookFile` are thin adapters
that just forward `Range`/`If-Range` and return `new Response(stream, { status, headers })`. It
returns one of 200/206/304/416 and always advertises `Accept-Ranges: bytes`, including on the 304
— the client that needs to resume is exactly the one that has seen a validator before.

Without resume, **any interrupted transfer is a total loss**: CrossPoint reads exactly
`Content-Length` bytes and hard-fails a short body with no retry. `If-Range` is honoured because
the validator is a content hash, so a mismatch means a genuinely different file. `Bun.file().slice()`
seeks rather than reading the skipped prefix, so resuming near the end of a 100 MB book costs
nothing.

## `Content-Disposition` is built by `attachmentDisposition`, never by hand

`src/lib/contentDisposition.ts`. Two traps, both shipped once: `filename*=UTF-8''…` can't be built
with `encodeURIComponent`, which leaves `' ( ) * ! ~` unescaped — and `'` is the ext-value's own
delimiter, so `The Handmaid's Tale.epub` parsed as `The Handmaid`. And `filename*` alone isn't
enough: a client implementing only plain `filename` falls back to the URL's last path segment.

## OPDS (`src/routes/opds.ts`)

Personal-library title and authors belong to the uploaded file. Linking a catalogue book must
only change its association, never overwrite those fields: unlinking otherwise leaves the wrong
book's metadata behind. The XRPC link/relink/unlink flow preserves them, as do automatic sync
matches. Existing metadata overwritten by the old manual-link handler cannot be recovered from
the database alone; this fix prevents future overwrites and does not reparse historical uploads.

Dual-format: OPDS 1.2 XML or 2.0 JSON based on `Accept`.

- **The trailing filename in a download URL is ignored by the route** — the content hash
  identifies the file, `personal_book.format` decides what's served. It's a _required_ segment,
  not an optional suffix (no name-less fallback), because e-readers dispatch on the URL, not the
  Content-Type: CrossPoint's OPDS parser scores a link higher when its href contains `.epub`,
  Kobo's built-in browser uses the extension alone. `core/downloadFilename.ts`'s
  `canonicalDownloadFilename` is the one source of that name, used in both the URL segment and the
  plain `filename` in `Content-Disposition` so a client reading the header and one scraping the URL
  agree byte for byte. It reduces to `[A-Za-z0-9._-]` (no percent-encoding needed anywhere, and no
  `/` can leak into the path), folds Latin diacritics, and falls back to `book` for scripts with no
  ASCII form — `filename*` carries the real name for those.
- **The acquisition rel is `.../acquisition/open-access`, not the bare `.../acquisition`.** The
  bare form only says _some_ acquisition is possible, entitling a strict reader to wait for an
  `indirectAcquisition` that never comes. Every client accepting the generic form accepts this one
  too (they substring-match the `opds-spec.org/acquisition` prefix).
- **Feed links use the request's own origin** (`requestOrigin`, honouring
  `x-forwarded-proto`/`x-forwarded-host`), not `PUBLIC_URL` — a reader that reached us on one
  hostname keeps following that hostname through pagination and search.
- **The download link is the one exception**: `OPDS_DOWNLOAD_BASE_URL`, when set, replaces its
  scheme+host, leaving the path untouched. This lets an e-reader's multi-MB transfer go straight at
  the app instead of through whatever proxies the public host — the redirect-through-Cloudflare
  arrangement it replaced was producing HTTP/2 stream resets mid-download. Only the download moves;
  feed, nav, and cover links stay on the requested host. Unset = unchanged behaviour.

## KOSync (`src/routes/sync/kosync.ts`)

- **A KOSync `document` id is not necessarily a content hash.** KOReader's checksum method is a
  user setting: `BINARY` (default) is a partial MD5 over the file, but `FILENAME` is
  `md5(basename)` — users switch to it precisely because their files aren't byte-identical across
  devices. `SAME_BOOK_FILE` (`data/syncMatching.ts`) is the one "same book" predicate (content
  hash, filename hash, or normalized filename), used as a **correlated subquery, never a join** —
  a document can match several files and vice versa, and a join fans that out into duplicate rows
  that also break `getPersonalLibrary`'s pagination.
- **The optional `metadata` payload** (KOReader's "Send document metadata" toggle, **default off**
  — most KOReader users send none of it; CrossPoint does) has two traps: `authors` is
  **newline-separated** (`doc_props.authors`), not comma- or tab-separated (three separators are in
  play app-wide: newline from KOReader, comma in `personal_book.authors`, tab in
  `hive_book.authors`). And `title` may itself be a filename — it's `doc_props.display_title`,
  which falls back to the filename stem when nothing's embedded, so `matchSyncDocument` runs it
  through the filename parser too.
- **Routes call `matchSyncDocumentForUser`, not `matchSyncDocument`.** With both KOReader defaults
  in force, the request identifies the book as one partial-MD5 hash and nothing else — matching the
  payload alone is hopeless. But that hash is `personal_book.contentHash`: if the user uploaded the
  file, real title/author metadata was already parsed at upload time and may already resolve to a
  book. `matchSyncDocumentForUser` finds the file first and inherits its `hiveId`, else falls back
  to the file's own metadata, writing the result back onto the file plus `user_book.owned`.
- **`matchSyncDocument`'s three tiers**, where **a wrong link is worse than no link** (it writes
  progress onto a book the user isn't reading and mirrors it to their PDS; a miss just leaves the
  document to link by hand):
  1. Exact `hive_book.id` hash of the client's title+author.
  2. Exact id hash of title/author pairs parsed out of the filename (both orderings of an
     `A - B` split are tried — safe because it resolves against the catalogue, so a wrong guess
     hashes to an id that doesn't exist).
  3. Fuzzy: FTS candidates searched by **author** as well as title (a title-only search can't reach
     "The Hitchhiker's Guide" from "Hitchhikers Guide"; an author's name is spelled the same either
     way). Acceptance is `titlesEquivalent` (equal content-word sets, gated **both** ways — one-way
     containment would accept "Dune" as "Dune Messiah") plus an agreeing author. With no author
     signal, only a title naming exactly one book is accepted.

  Don't gate any of this on title/author being present — that gate is what made a filename-only
  client unmatchable in the first place.

## XRPC service auth (`src/xrpc/auth.ts`)

`/xrpc/*` accepts the `sid` cookie **or** an atproto inter-service auth JWT
(`Authorization: Bearer <token>`, verified with `ServiceJwtVerifier`) — the latter is what makes
the personal library usable from a script or e-reader instead of only a browser session. Bearer
wins when both are present. A method declares `auth: "identity" | "pdsWrite"`; the wrapper in
`createXrpcRouter` derives the `lxm` from the schema's own NSID so a method's route and its token
binding can't drift apart.

- `identity` — we only need the DID (every personal-library/sync method).
- `pdsWrite` — writes to the user's repo, needs a live OAuth session. **Service auth can never
  satisfy this** — it proves key control, not that we hold a grant. Only the six book-list
  procedures need it.

Load-bearing details:

- **`acceptAudiences` is exact string `Array.includes`.** A bare DID does not match a
  `DID#fragment` audience, so both spellings are listed — the fragment is ahead of a PLC operation
  adding a `#bookhive_appview` service entry; today's live DID document only has `#atproto_pds`, so
  **PDS proxying via `atproto-proxy` cannot work yet** and clients must mint a token and POST to us
  directly.
- **`SERVICE_AUTH_MAX_AGE_SECONDS` is 3600, not atcute's 300** (`src/context.ts`). A PDS mints up to
  an hour when `lxm` is set and most SDKs don't expose `exp`, so the stricter default rejects
  ordinary tokens. The token's own `exp` is still enforced separately.
- **No prior-relationship gate.** A valid service token from any DID on the network is accepted —
  BookHive signup is open, so this bought little, and the per-user storage quota is the real
  backstop on what a caller can consume. `pdsWrite` methods stay refused either way.
- **No replay protection.** A token is scoped to one `lxm` and one audience; within its short
  window a reused one authenticates the same DID it always did.

`lexicons/auth.json` carries the `rpc` permission that lets a client mint these tokens at all;
**`GRANULAR_SCOPES` in `src/auth/client.ts` must move with it** (the `USE_PERMISSION_SETS = false`
fallback) — granting in only one place silently drops it for whichever path is live. Adding `rpc`
permissions means existing users must re-consent before their PDS issues tokens for these methods.

Example third-party call:

```http
# 1. Mint a token on YOUR OWN PDS, bound to one method and one audience.
GET  https://<your-pds>/xrpc/com.atproto.server.getServiceAuth
       ?aud=did:plc:enu2j5xjlqsjaylv3du4myh4
       &lxm=buzz.bookhive.uploadPersonalBook
       &exp=<now + 60>
  -> { "token": "..." }

# 2. Call BookHive directly. `filename` is a required query param; body is raw bytes.
POST https://bookhive.buzz/xrpc/buzz.bookhive.uploadPersonalBook?filename=Dune.epub
  Authorization: Bearer <token>
  Content-Type: application/epub+zip
  <raw bytes>
```
