import { sql, type SqlBool } from "kysely";

import type { Database } from "../db";
import { SAME_BOOK_FILE } from "./syncMatching";
import { KOSYNC_PROVIDER } from "./syncBridge";
import type { syncProgressView } from "./syncDocuments";

/**
 * **The one** "list this user's uploaded books", and **the one** row → wire
 * shape for them.
 *
 * - Cover precedence: local cover wins over the catalogue's everywhere.
 * - `hasLocalCover` travels with every result — the local cover URL needs a
 *   session cookie a service-auth client doesn't have.
 * - Title/authors always come from the file, not the catalogue.
 *
 * Pagination stays in the adapters (OPDS pages with `?page=`, XRPC with an
 * offset cursor) — this takes `{limit, offset}` and returns `{rows, total}`.
 */

/**
 * Every column any consumer renders — the union of what the OPDS entry builder
 * and the XRPC views need. It is a fixed list rather than `selectAll()` because
 * `personal_book` carries seven columns (`filePath`, `filenameHash`,
 * `filenameKey`, …) that nothing on a read path reads.
 */
const BOOK_COLUMNS = [
  "personal_book.id",
  "personal_book.contentHash",
  "personal_book.hiveId",
  "personal_book.filename",
  "personal_book.title",
  "personal_book.authors",
  "personal_book.language",
  "personal_book.format",
  "personal_book.mime",
  "personal_book.filePath",
  "personal_book.epubPath",
  "personal_book.coverPath",
  "personal_book.coverMime",
  "personal_book.sizeBytes",
  "personal_book.createdAt",
  "personal_book.updatedAt",
  "hive_book.cover as hiveBookCover",
  "hive_book.thumbnail as hiveBookThumbnail",
  "hive_book.description as hiveBookDescription",
] as const;

export type PersonalBookRowWithHive = {
  id: number;
  contentHash: string;
  hiveId: string | null;
  filename: string;
  title: string;
  authors: string | null;
  language: string | null;
  format: string;
  mime: string;
  filePath: string;
  epubPath: string | null;
  coverPath: string | null;
  coverMime: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  hiveBookCover?: string | null;
  hiveBookThumbnail?: string | null;
  hiveBookDescription?: string | null;
  /** Only present on the listing, which selects the correlated progress subqueries. */
  progressData?: string | null;
  progressUpdatedAt?: string | null;
};

export type PersonalBookSort = "recent" | "title" | "author";

/**
 * The user's own cover if we stored one, else the catalogue's.
 *
 * The local URL needs a session cookie, which is why `hasLocalCover` travels
 * with it: a service-auth client reads that flag and calls
 * `getPersonalBookCover` instead.
 */
export function personalCoverUrl(row: {
  contentHash: string;
  coverPath: string | null;
  hiveBookCover?: string | null;
  hiveBookThumbnail?: string | null;
}): string | undefined {
  if (row.coverPath) return `/library/covers/${row.contentHash}`;
  return row.hiveBookCover ?? row.hiveBookThumbnail ?? undefined;
}

type SyncProgress = ReturnType<typeof syncProgressView>;

/** The JSON shape every XRPC personal-library method answers with. */
export function personalBookView(
  row: PersonalBookRowWithHive,
  extra?: {
    shelfIds?: number[];
    progress?: SyncProgress;
  },
) {
  return {
    contentHash: row.contentHash,
    title: row.title,
    authors: row.authors ?? undefined,
    language: row.language ?? undefined,
    format: row.format,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    filename: row.filename,
    description: row.hiveBookDescription ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hiveId: row.hiveId ?? undefined,
    coverUrl: personalCoverUrl(row),
    hasLocalCover: Boolean(row.coverPath),
    ...(extra?.progress !== undefined ? { progress: extra.progress } : {}),
    ...(extra?.shelfIds !== undefined ? { shelfIds: extra.shelfIds } : {}),
  };
}

export async function getPersonalBookRow({
  db,
  userDid,
  contentHash,
}: {
  db: Database;
  userDid: string;
  contentHash: string;
}): Promise<PersonalBookRowWithHive | undefined> {
  return (await db
    .selectFrom("personal_book")
    .leftJoin("hive_book", "personal_book.hiveId", "hive_book.id")
    .select(BOOK_COLUMNS)
    .where("personal_book.userDid", "=", userDid)
    .where("personal_book.contentHash", "=", contentHash)
    .executeTakeFirst()) as PersonalBookRowWithHive | undefined;
}

export async function listPersonalBooks({
  db,
  userDid,
  shelfId,
  q,
  sort = "recent",
  limit,
  offset,
  withProgress = false,
}: {
  db: Database;
  userDid: string;
  shelfId?: number | undefined;
  q?: string | undefined;
  sort?: PersonalBookSort;
  limit: number;
  offset: number;
  /** Selects the correlated e-reader progress subqueries. Only the XRPC listing needs them. */
  withProgress?: boolean;
}): Promise<{ rows: PersonalBookRowWithHive[]; total: number }> {
  const like = q ? `%${q}%` : null;

  // Raw SQL so the same predicate can be shared between the data query (which
  // joins hive_book) and the count query (which doesn't) — a typed
  // ExpressionBuilder predicate couldn't be. They must share it or the pager
  // can advertise a last page that renders empty.
  const matchesQ = sql<SqlBool>`(personal_book.title LIKE ${like} OR personal_book.authors LIKE ${like})`;

  let query = db
    .selectFrom("personal_book")
    .leftJoin("hive_book", "personal_book.hiveId", "hive_book.id")
    .select(BOOK_COLUMNS)
    .where("personal_book.userDid", "=", userDid)
    .$if(Boolean(like), (qb) => qb.where(matchesQ));

  if (withProgress) {
    // Correlated subqueries, not a join — SAME_BOOK_FILE can match a file to
    // more than one synced document, and a join would emit the book once per
    // match and corrupt pagination. Both subqueries order on `id` as a final
    // tiebreaker so they resolve to the *same* row when `updatedAt` ties;
    // otherwise progressData and progressUpdatedAt could be stamped from two
    // different documents.
    const latestSyncDocument = () =>
      db
        .selectFrom("sync_document")
        .where("sync_document.userDid", "=", userDid)
        .where("sync_document.provider", "=", KOSYNC_PROVIDER)
        .where(SAME_BOOK_FILE)
        .orderBy("sync_document.updatedAt", "desc")
        .orderBy("sync_document.id", "desc")
        .limit(1);

    query = query.select(() => [
      latestSyncDocument().select("sync_document.progressData").as("progressData"),
      latestSyncDocument().select("sync_document.updatedAt").as("progressUpdatedAt"),
    ]) as typeof query;
  }

  if (shelfId !== undefined) {
    query = query
      .innerJoin("personal_shelf_item", "personal_book.id", "personal_shelf_item.personalBookId")
      .where("personal_shelf_item.shelfId", "=", shelfId) as typeof query;
  }

  // Every sort ends on personal_book.id as a tiebreaker — none of the leading
  // keys are unique, and SQLite may order ties differently between two
  // LIMIT/OFFSET queries.
  query =
    sort === "title"
      ? (query
          .orderBy("personal_book.title", "asc")
          .orderBy("personal_book.id", "asc") as typeof query)
      : sort === "author"
        ? (query
            .orderBy("personal_book.authors", "asc")
            .orderBy("personal_book.title", "asc")
            .orderBy("personal_book.id", "asc") as typeof query)
        : (query
            .orderBy("personal_book.createdAt", "desc")
            .orderBy("personal_book.id", "desc") as typeof query);

  let countQuery = db
    .selectFrom("personal_book")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("personal_book.userDid", "=", userDid)
    .$if(Boolean(like), (qb) => qb.where(matchesQ));
  if (shelfId !== undefined) {
    countQuery = countQuery
      .innerJoin("personal_shelf_item", "personal_book.id", "personal_shelf_item.personalBookId")
      .where("personal_shelf_item.shelfId", "=", shelfId) as typeof countQuery;
  }

  const [rows, counted] = await Promise.all([
    query.limit(limit).offset(offset).execute(),
    countQuery.executeTakeFirstOrThrow(),
  ]);

  return { rows: rows as PersonalBookRowWithHive[], total: Number(counted.total) };
}

/** Shelf membership for a page of books, in one query. */
export async function shelfIdsForBooks({
  db,
  userDid,
  bookIds,
}: {
  db: Database;
  userDid: string;
  bookIds: number[];
}): Promise<Map<number, number[]>> {
  const byBook = new Map<number, number[]>();
  if (bookIds.length === 0) return byBook;
  const memberships = await db
    .selectFrom("personal_shelf_item")
    .innerJoin("personal_shelf", "personal_shelf.id", "personal_shelf_item.shelfId")
    .select(["personal_shelf_item.personalBookId", "personal_shelf_item.shelfId"])
    .where("personal_shelf.userDid", "=", userDid)
    .where("personal_shelf_item.personalBookId", "in", bookIds)
    .execute();
  for (const m of memberships) {
    const list = byBook.get(m.personalBookId);
    if (list) list.push(m.shelfId);
    else byBook.set(m.personalBookId, [m.shelfId]);
  }
  return byBook;
}
