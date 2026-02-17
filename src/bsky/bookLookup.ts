import { sql } from "kysely";
import type { Database } from "../db";
import type { BookIdentifiers, HiveId } from "../types";
import type { HiveBook } from "../types";

type DbCtx = { db: Database };

/** Lexicon API shape for buzz.bookhive.hiveBook ($type + null → undefined). */
export type HiveBookOutput = {
  $type: "buzz.bookhive.hiveBook";
  id: string;
  title: string;
  authors: string;
  thumbnail: string;
  createdAt: string;
  updatedAt: string;
  cover?: string;
  description?: string;
  rating?: number;
  ratingsCount?: number;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  identifiers?: BookIdentifiers;
};

/**
 * Map a hive book + identifiers to the lexicon hiveBook output shape.
 * Use this when you already have resolved identifiers (e.g. from findBookIdentifiersByLookup).
 */
export function toHiveBookOutput(
  book: HiveBook,
  identifiers: BookIdentifiers,
): HiveBookOutput {
  return {
    $type: "buzz.bookhive.hiveBook",
    id: book.id,
    title: book.title,
    authors: book.authors,
    thumbnail: book.thumbnail ?? "",
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    cover: book.cover ?? undefined,
    description: book.description ?? undefined,
    rating: book.rating ?? undefined,
    ratingsCount: book.ratingsCount ?? undefined,
    source: book.source ?? undefined,
    sourceId: book.sourceId ?? undefined,
    sourceUrl: book.sourceUrl ?? undefined,
    identifiers,
  };
}

/**
 * Transform a HiveBook DB row to the lexicon hiveBook output shape.
 * Parses identifiers from book.identifiers (JSON string) with hiveId always included.
 */
export function transformBookWithIdentifiers<
  T extends { id: string; identifiers: string | null | undefined } & Pick<
    HiveBook,
    | "title"
    | "authors"
    | "thumbnail"
    | "createdAt"
    | "updatedAt"
    | "cover"
    | "description"
    | "rating"
    | "ratingsCount"
    | "source"
    | "sourceId"
    | "sourceUrl"
  >,
>(book: T): HiveBookOutput {
  const identifiers: BookIdentifiers = {
    hiveId: book.id,
    ...(book.identifiers
      ? (JSON.parse(book.identifiers) as BookIdentifiers)
      : {}),
  };
  return toHiveBookOutput(book as unknown as HiveBook, identifiers);
}

export async function findBookIdentifiersByLookup({
  ctx,
  hiveId,
  isbn10,
  isbn13,
  goodreadsId,
}: {
  ctx: DbCtx;
  hiveId?: HiveId | null;
  isbn10?: string | null;
  isbn13?: string | null;
  goodreadsId?: string | null;
}) {
  if (!hiveId && !isbn10 && !isbn13 && !goodreadsId) {
    return undefined;
  }

  let query = ctx.db.selectFrom("book_id_map").selectAll();

  if (hiveId) {
    query = query.where("hiveId", "=", hiveId);
  }
  if (isbn10) {
    query = query.where("isbn", "=", isbn10);
  }
  if (isbn13) {
    query = query.where("isbn13", "=", isbn13);
  }
  if (goodreadsId) {
    query = query.where("goodreadsId", "=", goodreadsId);
  }

  return query.executeTakeFirst();
}

export async function findHiveBookByBookIdentifiersLookup({
  ctx,
  hiveId,
  isbn10,
  isbn13,
  goodreadsId,
}: {
  ctx: DbCtx;
  hiveId: HiveId | null;
  isbn10: string | null;
  isbn13: string | null;
  goodreadsId: string | null;
}): Promise<HiveBook | undefined> {
  if (hiveId) {
    const byHiveId = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", hiveId)
      .executeTakeFirst();
    if (byHiveId) {
      return byHiveId;
    }
  }

  if (goodreadsId) {
    const byGoodreadsId = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("source", "=", "Goodreads")
      .where((eb) =>
        eb.or([
          eb("sourceId", "=", goodreadsId),
          eb("sourceUrl", "like", `%/book/show/${goodreadsId}%`),
        ]),
      )
      .executeTakeFirst();
    if (byGoodreadsId) {
      return byGoodreadsId;
    }
  }

  if (isbn10) {
    const byIsbn = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where(
        sql<
          string | null
        >`NULLIF(REPLACE(REPLACE(UPPER(CAST(json_extract(meta, '$.isbn') AS TEXT)), '-', ''), ' ', ''), '')`,
        "=",
        isbn10,
      )
      .executeTakeFirst();
    if (byIsbn) {
      return byIsbn;
    }
  }

  if (isbn13) {
    const byIsbn13 = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where(
        sql<
          string | null
        >`NULLIF(REPLACE(REPLACE(CAST(json_extract(meta, '$.isbn13') AS TEXT), '-', ''), ' ', ''), '')`,
        "=",
        isbn13,
      )
      .executeTakeFirst();
    if (byIsbn13) {
      return byIsbn13;
    }
  }

  return undefined;
}
