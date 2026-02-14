import { sql } from "kysely";
import type { Database } from "../db";
import type { BookIdentifiers, HiveId } from "../types";
import type { HiveBook } from "../types";

type DbCtx = { db: Database };

/**
 * Transform a HiveBook database row to include parsed identifiers with hiveId always included
 */
export function transformBookWithIdentifiers<
  T extends { id: string; identifiers: string | null | undefined },
>(book: T): Omit<T, "identifiers"> & { identifiers: BookIdentifiers } {
  const { identifiers, ...rest } = book;
  return {
    ...rest,
    identifiers: {
      hiveId: book.id,
      ...(identifiers ? (JSON.parse(identifiers) as BookIdentifiers) : {}),
    },
  };
}

export async function findBookIdentifiersByLookup({
  ctx,
  hiveId,
  isbn,
  isbn13,
  goodreadsId,
}: {
  ctx: DbCtx;
  hiveId?: HiveId | null;
  isbn?: string | null;
  isbn13?: string | null;
  goodreadsId?: string | null;
}) {
  let query = ctx.db.selectFrom("book_id_map").selectAll();

  if (hiveId) {
    query = query.where("hiveId", "=", hiveId);
  }
  if (isbn) {
    query = query.where("isbn", "=", isbn);
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
  isbn,
  isbn13,
  goodreadsId,
}: {
  ctx: DbCtx;
  hiveId: HiveId | null;
  isbn: string | null;
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

  if (isbn) {
    const byIsbn = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where(
        sql<
          string | null
        >`NULLIF(REPLACE(REPLACE(UPPER(CAST(json_extract(meta, '$.isbn') AS TEXT)), '-', ''), ' ', ''), '')`,
        "=",
        isbn,
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
