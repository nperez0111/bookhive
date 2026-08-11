import { sql } from "kysely";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { getHiveId } from "../scrapers/getHiveId";
import { parseAuthors } from "./authorMatching";
import { ftsMatchQuery } from "./ftsQuery";
import {
  authorsMatch,
  filenameBookCandidates,
  filenameKey,
  normalizeAuthor,
  normalizeTitle,
  titlesEquivalent,
  type FilenameCandidate,
} from "./filenameMatching";
import { similarityScore } from "./bookMatching";

/**
 * Sentinel written to `sync_document.hiveId` when the user asserts a synced
 * document has no BookHive counterpart. Shaped like a HiveId so the column type
 * holds, but it can never collide with a real `hive_book.id` (those are content
 * hashes). Because every auto-match path only runs when `hiveId` is falsy, the
 * sentinel also permanently stops re-matching — which is the point.
 *
 * Read paths must translate it outward as `{ hiveId: null, dismissed: true }`
 * so no client ever links to `/books/bk_none`.
 */
export const NO_HIVE_MATCH = "bk_none" as HiveId;

/**
 * Cap on how much filename guessing one progress push is allowed to pay for.
 * This runs on every push for a document that has not matched yet, so an
 * unmatchable document re-pays it every few minutes, per device.
 */
const MAX_FTS_QUERIES = 4;
const FTS_LIMIT = 50;

/**
 * "This synced document and this uploaded file are the same book."
 *
 * Three ways that can be true, and a KOSync client only ever gives us one of
 * them, so all three have to be tried:
 *
 * 1. `contentHash = documentHash` — the client is in BINARY checksum mode and
 *    the file we hold is byte-identical to the one on the device. The original
 *    (and only) rule.
 * 2. `filenameHash = documentHash` — the client is in FILENAME mode, so what it
 *    calls a document id is md5 of the basename. Nothing about the bytes is
 *    involved and rule 1 can never fire for these users.
 * 3. `filenameKey = filenameKey` — neither hash lines up, but the client sent a
 *    readable filename that normalizes to the same thing as ours. This is the
 *    calibre-conversion case: same book, different bytes *and* a different
 *    extension.
 *
 * Written as raw SQL because both directions of the relationship need it, as a
 * correlated subquery rather than a join — a document can match more than one
 * file and vice versa, and a join would fan those out into duplicate rows in
 * the library grid and break its pagination.
 *
 * Both `filenameKey` columns are nullable and `NULL = NULL` is not true in SQL,
 * so a document with no filename cannot match a file with no key.
 */
export const SAME_BOOK_FILE = sql<boolean>`(
  personal_book.contentHash = sync_document.documentHash
  OR personal_book.filenameHash = sync_document.documentHash
  OR personal_book.filenameKey = sync_document.filenameKey
)`;

type FtsRow = { id: HiveId; title: string; authors: string | null; ratingsCount: number | null };

/**
 * Split an author *signal* into individual names. Three sources reach this and
 * each separates authors differently:
 *
 * - KOReader's `metadata.authors` is **newline**-separated (`doc_props.authors`
 *   is one of the three props its metadata editor opens with
 *   `allow_newline = true`).
 * - `personal_book.authors` is **comma**-separated (`parseBook` joins epub
 *   `dc:creator` values with ", ").
 * - `hive_book.authors` is tab-separated, but that side goes through
 *   `parseAuthors`, not here.
 *
 * The comma is ambiguous — it also inverts a single name ("Le Guin, Ursula") —
 * so rather than guess, the whole string is emitted *alongside* the split
 * parts and both interpretations are tried. That is safe because signals are
 * only ever used as corroborating evidence: one that matches nothing simply
 * fails to confirm, it cannot select a book on its own.
 */
function splitAuthorSignal(value: string | null | undefined): string[] {
  if (!value) return [];
  const parts = value
    .split(/[\r\n\t;&]|\band\b/i)
    .map((a) => a.trim())
    .filter(Boolean);
  const withCommaSplits = parts.flatMap((part) =>
    part.includes(",") ? [part, ...part.split(",").map((a) => a.trim())] : [part],
  );
  return dedupe(withCommaSplits.filter(Boolean));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Merge candidate lists, keeping the first (most confident) of each pair. */
function dedupeCandidates(candidates: FilenameCandidate[]): FilenameCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.title}\0${c.authors ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolve a synced e-reader document to a `hive_book`.
 *
 * Three tiers, strongest first. The rule that governs all of them is that a
 * wrong link is worse than no link — it writes someone's reading progress onto
 * a book they aren't reading, and (via `bridgeProgressToUserBook`) mirrors that
 * to their PDS. A miss just leaves the document unlinked for the user to
 * connect by hand, and the progress itself is stored either way, so e-reader
 * sync is unaffected.
 *
 * 1. **Exact id hash of the supplied metadata.** `hive_book.id` is a hash of
 *    the lowercased title + author, so a hit is an exact identity, not a
 *    search.
 * 2. **Exact id hash of title/author pairs parsed out of the filename**,
 *    including pairs that cross client metadata with a filename-derived author.
 *    Still exact: a wrong guess hashes to an id that does not exist.
 * 3. **FTS on the filename-derived title**, accepted only when the normalized
 *    title is *equal* (not merely ranked first) and the author agrees. With no
 *    author signal at all, only an unambiguous single-book title is accepted.
 *
 * Tiers 2 and 3 exist because the filename is frequently the only thing we get.
 * KOSync's own metadata is optional (KOReader's `send_metadata` defaults off;
 * CrossPoint sends it) and plenty of documents carry no embedded title or
 * author at all — but "Ursula K. Le Guin - The Dispossessed.epub" names a book
 * perfectly well.
 *
 * This takes only what the client sent. Prefer `matchSyncDocumentForUser`,
 * which also brings the user's own uploaded files to bear — it is the only
 * thing that helps a default-configured client, which sends no metadata at all.
 */
export async function matchSyncDocument(
  db: Database,
  metadata: { title?: string | null; authors?: string | null; filename?: string | null },
): Promise<HiveId | null> {
  const { title, authors, filename } = metadata;

  // The client's `title` may itself be a filename. KOReader sends
  // `doc_props.display_title`, which is `props.title or
  // splitFileNameType(filepath)` — for any document with no embedded title (a
  // conversion, most scanned PDFs, plenty of epubs) that is literally the
  // filename minus its extension, dashes and all. So parse it the same way.
  const candidates = dedupeCandidates([
    ...filenameBookCandidates(filename),
    ...filenameBookCandidates(title),
  ]);
  if (!title && candidates.length === 0) return null;

  // ── Tiers 1 + 2: exact id hashes, most confident first ──
  const ids: HiveId[] = [];
  const considerId = (t: string, a: string) => {
    const id = getHiveId({ title: t, authors: a });
    if (!ids.includes(id)) ids.push(id);
  };

  if (title) considerId(title, authors || "Unknown");
  for (const c of candidates) {
    if (c.authors) considerId(c.title, c.authors);
    if (authors) considerId(c.title, authors);
  }
  // The client named the book but not the author; the filename may have one.
  if (title) {
    for (const c of candidates) {
      if (c.authors) considerId(title, c.authors);
    }
  }

  if (ids.length > 0) {
    const found = await db.selectFrom("hive_book").select("id").where("id", "in", ids).execute();
    if (found.length > 0) {
      const hit = new Set(found.map((r) => r.id));
      // Resolve in the order the ids were generated, so client metadata beats a
      // filename guess and a two-sided guess beats a one-sided one.
      const best = ids.find((id) => hit.has(id));
      if (best) return best;
    }
  }

  // ── Tier 3: fuzzy, on the filename only ──
  const authorSignals = dedupe([
    ...splitAuthorSignal(authors),
    ...candidates.flatMap((c) => splitAuthorSignal(c.authors)),
  ]);

  // Candidate pool. `hive_book_fts` matches phrases, so searching it for the
  // title only finds books whose title tokenizes the same way — "Hitchhikers
  // Guide" never reaches "The Hitchhiker's Guide". Searching for the *author*
  // instead sidesteps that: an author's name is spelled the same either way,
  // and their handful of books can then be compared on title in JS, where the
  // comparison can be as forgiving as it needs to be. The title search stays
  // as the only option when the filename yields no author at all.
  const authorQueries: string[] = [];
  for (const signal of authorSignals) {
    const q = ftsMatchQuery(normalizeAuthor(signal));
    if (q) authorQueries.push(q);
  }
  const titleQueries: string[] = [];
  const seenTitles = new Set<string>();
  for (const candidate of candidates) {
    const want = normalizeTitle(candidate.title);
    if (!want || seenTitles.has(want)) continue;
    seenTitles.add(want);
    const q = ftsMatchQuery(candidate.title);
    if (q) titleQueries.push(q);
  }

  // Author queries lead — they are the ones that can reach a title we'd never
  // tokenize our way to. But they must not consume the whole budget: an `A - B`
  // filename contributes an author signal for *both* orderings, so four junk
  // signals could crowd the title query out entirely and leave the pool empty
  // when the title alone would have found the book. One slot is always held
  // back for the first title query.
  const deduped = dedupe([...authorQueries, ...titleQueries]);
  const firstTitle = deduped.find((q) => titleQueries.includes(q));
  let queries = deduped.slice(0, MAX_FTS_QUERIES);
  if (firstTitle && !queries.includes(firstTitle)) {
    queries = [...queries.slice(0, MAX_FTS_QUERIES - 1), firstTitle];
  }

  const pool = new Map<HiveId, FtsRow>();
  for (const match of queries) {
    const rows = (
      await sql<FtsRow>`
        SELECT b.id, b.title, b.authors, b.ratingsCount
        FROM hive_book_fts f
        JOIN hive_book b ON b.rowid = f.rowid
        WHERE hive_book_fts MATCH ${match}
        ORDER BY b.ratingsCount DESC, b.rating DESC
        LIMIT ${FTS_LIMIT}
      `.execute(db)
    ).rows;
    for (const row of rows) if (!pool.has(row.id)) pool.set(row.id, row);
  }
  if (pool.size === 0) return null;

  const books = [...pool.values()].sort((a, b) => (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0));

  for (const candidate of candidates) {
    // Ranking is by popularity, which says nothing about whether the top hit is
    // *this* book. Only titles that name the same book are eligible.
    const eligible = books.filter((r) => titlesEquivalent(candidate.title, r.title));
    if (eligible.length === 0) continue;

    if (authorSignals.length > 0) {
      const byAuthor = eligible.filter((r) =>
        parseAuthors(r.authors || "").some((bookAuthor) =>
          authorSignals.some((signal) => authorsMatch(bookAuthor, signal)),
        ),
      );
      // Several editions can agree on both; prefer the closest title, then the
      // popularity order the query already applied.
      const hit = byAuthor.reduce<FtsRow | null>(
        (best, r) =>
          best === null ||
          similarityScore(candidate.title, r.title) > similarityScore(candidate.title, best.title)
            ? r
            : best,
        null,
      );
      if (hit) return hit.id;
      // The title matched but no author did: this is a different book with the
      // same name. Fall through to the next candidate rather than to the
      // no-author rule below, which would accept it.
      continue;
    }

    // No author anywhere. Accept only a title that names exactly one book in
    // the catalogue — otherwise we would be picking the most popular of several
    // unrelated books that happen to share a title.
    const distinct = new Set(eligible.map((r) => r.id));
    if (distinct.size === 1) return eligible[0]!.id;
  }

  return null;
}

/**
 * Resolve a synced document to a book using everything we hold for this user,
 * not just what the client sent.
 *
 * This is the entry point the KOSync routes use, and it exists for the
 * **default** KOReader configuration, which is the majority: `checksum_method`
 * is BINARY and `send_metadata` is off, so the entire request identifies the
 * book as one partial-MD5 hash and nothing else. `matchSyncDocument` has
 * nothing to work with — no title, no author, no filename — and returns null
 * every time, forever, no matter how good its tiers get.
 *
 * But that hash *is* `personal_book.contentHash`. If the user has uploaded the
 * file, we already parsed real title/author metadata out of the ebook itself at
 * upload time, and may already have resolved it to a book. So: find the file
 * first, inherit its book if it has one, and otherwise match on the file's
 * metadata. The upload path already pushes a link the other way when the
 * document exists first (`uploadPersonalBook` step 9); this closes the opposite
 * ordering, where the file is uploaded before the e-reader ever syncs it.
 */
export async function matchSyncDocumentForUser(
  db: Database,
  userDid: string,
  doc: {
    documentHash: string;
    filename?: string | null;
    title?: string | null;
    authors?: string | null;
  },
): Promise<HiveId | null> {
  const docFilenameKey = filenameKey(doc.filename);
  const file = await db
    .selectFrom("personal_book")
    .select(["id", "hiveId", "title", "authors", "filename"])
    .where("userDid", "=", userDid)
    .where((eb) =>
      eb.or([
        eb("contentHash", "=", doc.documentHash),
        eb("filenameHash", "=", doc.documentHash),
        ...(docFilenameKey ? [eb("filenameKey", "=", docFilenameKey)] : []),
      ]),
    )
    // A byte-identical file is a stronger claim than a same-name one.
    .orderBy(sql`CASE WHEN contentHash = ${doc.documentHash} THEN 0 ELSE 1 END`, "asc")
    .executeTakeFirst();

  if (file?.hiveId && file.hiveId !== NO_HIVE_MATCH) return file.hiveId;

  let hiveId = await matchSyncDocument(db, doc);
  if (!hiveId && file) {
    // The ebook's own metadata, parsed from the file at upload time. Usually
    // better than anything a filename can offer, and for a default-configured
    // client it is the only thing there is.
    hiveId = await matchSyncDocument(db, {
      title: file.title,
      authors: file.authors,
      filename: file.filename,
    });
  }

  if (hiveId && file && !file.hiveId) {
    // Keep the file and the document agreeing, and mirror the upload path's
    // "you own a copy" flag. The `hiveId is null` guard is enforced in the
    // statement, not just by the `!file.hiveId` read above: two sync pushes for
    // the same file can race between the SELECT and this UPDATE, and the loser
    // would otherwise overwrite a link the winner just established.
    await db
      .updateTable("personal_book")
      .set({ hiveId })
      .where("id", "=", file.id)
      .where("hiveId", "is", null)
      .execute();
    await db
      .updateTable("user_book")
      .set({ owned: 1 })
      .where("userDid", "=", userDid)
      .where("hiveId", "=", hiveId)
      .where("owned", "=", 0)
      .execute();
  }

  return hiveId;
}
