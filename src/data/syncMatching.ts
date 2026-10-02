import { sql } from "kysely";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { getHiveId } from "../scrapers/getHiveId";
import { parseAuthors } from "../core/authors";
import { ftsMatchQuery } from "../core/ftsQuery";
import {
  authorsMatch,
  filenameBookCandidates,
  filenameKey,
  normalizeAuthor,
  normalizeTitle,
  titlesEquivalent,
  type FilenameCandidate,
} from "../core/filenameMatching";
import { similarityScore } from "../core/bookMatching";

/**
 * Sentinel written to `sync_document.hiveId` when the user asserts a synced
 * document has no BookHive counterpart. Shaped like a HiveId so the column type
 * holds, but it can never collide with a real `hive_book.id` (those are content
 * hashes). Every auto-match path only runs when `hiveId` is falsy, so the
 * sentinel also permanently stops re-matching — that's the point. Read paths
 * must translate it outward as `{ hiveId: null, dismissed: true }` so no client
 * ever links to `/books/bk_none`.
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
 * "This synced document and this uploaded file are the same book." Three ways
 * that can be true, and a KOSync client only ever gives us one of them, so all
 * three have to be tried:
 *
 * 1. `contentHash = documentHash` — client is in BINARY checksum mode and the
 *    file we hold is byte-identical to the one on the device.
 * 2. `filenameHash = documentHash` — client is in FILENAME mode, so the
 *    document id is md5 of the basename; rule 1 can never fire for these users.
 * 3. `filenameKey = filenameKey` — neither hash lines up, but the filename
 *    normalizes to the same thing as ours (e.g. a calibre re-conversion: same
 *    book, different bytes and extension).
 *
 * A correlated subquery rather than a join, because a document can match more
 * than one file and vice versa, and a join would fan that out into duplicate
 * rows and break the library grid's pagination. Both `filenameKey` columns are
 * nullable and `NULL = NULL` is not true in SQL, so a document with no filename
 * cannot match a file with no key.
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
 * - KOReader's `metadata.authors` is **newline**-separated.
 * - `personal_book.authors` is **comma**-separated.
 * - `hive_book.authors` is tab-separated, but that side goes through
 *   `parseAuthors`, not here.
 *
 * The comma is ambiguous — it also inverts a single name ("Le Guin, Ursula") —
 * so rather than guess, the whole string is emitted *alongside* the split parts
 * and both interpretations are tried. Safe because signals are only ever
 * corroborating evidence: one that matches nothing simply fails to confirm.
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
 * Resolve a synced e-reader document to a `hive_book`. Three tiers, strongest
 * first; the rule governing all of them is that a wrong link is worse than no
 * link — it writes someone's reading progress onto a book they aren't reading
 * and mirrors that to their PDS, while a miss just leaves the document
 * unlinked for the user to connect by hand.
 *
 * 1. **Exact id hash of the supplied metadata.** `hive_book.id` is a hash of
 *    the lowercased title + author, so a hit is an exact identity, not a search.
 * 2. **Exact id hash of title/author pairs parsed out of the filename**,
 *    including pairs that cross client metadata with a filename-derived author.
 *    Still exact: a wrong guess hashes to an id that does not exist.
 * 3. **FTS on the filename-derived title**, accepted only when the normalized
 *    title is *equal* (not merely ranked first) and the author agrees. With no
 *    author signal at all, only an unambiguous single-book title is accepted.
 *
 * Tiers 2 and 3 exist because the filename is frequently the only thing we
 * get — KOSync's own metadata is optional and plenty of documents carry no
 * embedded title or author at all.
 *
 * This takes only what the client sent. Prefer `matchSyncDocumentForUser`,
 * which also brings the user's own uploaded files to bear — the only thing
 * that helps a default-configured client, which sends no metadata at all.
 */
export async function matchSyncDocument(
  db: Database,
  metadata: { title?: string | null; authors?: string | null; filename?: string | null },
): Promise<HiveId | null> {
  const { title, authors, filename } = metadata;

  // The client's `title` may itself be a filename (KOReader falls back to the
  // filename stem when a document has no embedded title), so parse it the same way.
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
      // Resolve in id-generation order, so client metadata beats a filename guess.
      const best = ids.find((id) => hit.has(id));
      if (best) return best;
    }
  }

  // ── Tier 3: fuzzy, on the filename only ──
  const authorSignals = dedupe([
    ...splitAuthorSignal(authors),
    ...candidates.flatMap((c) => splitAuthorSignal(c.authors)),
  ]);

  // Candidate pool. `hive_book_fts` matches phrases, so a title search alone
  // never reaches "The Hitchhiker's Guide" from "Hitchhikers Guide"; searching
  // by author instead sidesteps that, since a name is spelled the same either
  // way and its books can then be compared on title in JS.
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

  // Author queries lead, but must not consume the whole budget — an `A - B`
  // filename contributes an author signal for both orderings, which could
  // crowd the title query out entirely. One slot is always held back for it.
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
        ORDER BY b.ratingsCount DESC, b.rating DESC, b.id ASC
        LIMIT ${FTS_LIMIT}
      `.execute(db)
    ).rows;
    for (const row of rows) if (!pool.has(row.id)) pool.set(row.id, row);
  }
  if (pool.size === 0) return null;

  // `id` breaks both ties. `ratingsCount` is 0 for most of the catalogue, so
  // without a unique final key the same document could match a different book
  // on a later request with no user action.
  const books = [...pool.values()].sort(
    (a, b) => (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0) || a.id.localeCompare(b.id),
  );

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
      // Several editions can agree on both; prefer the closest title.
      const hit = byAuthor.reduce<FtsRow | null>(
        (best, r) =>
          best === null ||
          similarityScore(candidate.title, r.title) > similarityScore(candidate.title, best.title)
            ? r
            : best,
        null,
      );
      if (hit) return hit.id;
      // Title matched but no author did: a different book with the same name.
      // Fall through rather than to the no-author rule below, which would accept it.
      continue;
    }

    // No author anywhere. Accept only a title that names exactly one book in
    // the catalogue, else we'd be picking arbitrarily among unrelated books sharing a title.
    const distinct = new Set(eligible.map((r) => r.id));
    if (distinct.size === 1) return eligible[0]!.id;
  }

  return null;
}

/**
 * Resolve a synced document to a book using everything we hold for this user,
 * not just what the client sent. This is the entry point the KOSync routes use,
 * and it exists for the **default** KOReader configuration: `checksum_method`
 * is BINARY and `send_metadata` is off, so the request identifies the book as
 * one partial-MD5 hash and nothing else — `matchSyncDocument` alone would
 * return null every time.
 *
 * That hash *is* `personal_book.contentHash`, though: if the user uploaded the
 * file, we already parsed real title/author metadata out of it at upload time
 * and may already have resolved it to a book. So: find the file first, inherit
 * its book if it has one, else match on the file's metadata. The upload path
 * already pushes a link the other way when the document exists first; this
 * closes the opposite ordering.
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
    // Within a bucket the match is on filename, which isn't unique (two formats,
    // a re-upload); `personal_book.id` is the tiebreak this table uses everywhere else.
    .orderBy("id", "asc")
    .executeTakeFirst();

  if (file?.hiveId && file.hiveId !== NO_HIVE_MATCH) return file.hiveId;

  let hiveId = await matchSyncDocument(db, doc);
  if (!hiveId && file) {
    // The ebook's own metadata, parsed from the file at upload time — usually
    // better than a filename, and for a default-configured client it's the only thing there is.
    hiveId = await matchSyncDocument(db, {
      title: file.title,
      authors: file.authors,
      filename: file.filename,
    });
  }

  if (hiveId && file && !file.hiveId) {
    // Keep the file and document agreeing, and mirror the upload path's "you
    // own a copy" flag. The `hiveId is null` guard is enforced in the
    // statement, not just the `!file.hiveId` read above, because two sync
    // pushes for the same file can race between the SELECT and this UPDATE.
    const updated = await db
      .updateTable("personal_book")
      .set({ hiveId })
      .where("id", "=", file.id)
      .where("hiveId", "is", null)
      .executeTakeFirst();

    // Lost the race: another request linked this file first, possibly to a
    // *different* book. Adopt whatever it persisted instead of our own guess.
    if (!updated.numUpdatedRows) {
      const current = await db
        .selectFrom("personal_book")
        .select("hiveId")
        .where("id", "=", file.id)
        .executeTakeFirst();
      // Clear to null when the winner dismissed the match or the row vanished,
      // so the ownership update below matches nothing rather than writing a wrong link.
      hiveId = current?.hiveId && current.hiveId !== NO_HIVE_MATCH ? current.hiveId : null;
    }

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
