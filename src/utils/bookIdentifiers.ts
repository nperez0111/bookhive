import { sql } from "kysely";
import type { Database } from "../db";
import type { BookIdentifiers, BookIdentifiersRow, HiveBook, HiveId } from "../types";

type BookIdentifiersSource = Pick<HiveBook, "id" | "source" | "sourceId" | "sourceUrl" | "meta">;

type ParsedMeta = {
  isbn?: unknown;
  isbn13?: unknown;
};

const GOODREADS_BOOK_PATH_REGEX = /\/book\/show\/([^/?#]+)/i;

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeHiveId(value: string | null | undefined): HiveId | null {
  const normalized = normalizeString(value);
  return normalized ? (normalized as HiveId) : null;
}

export function normalizeIsbn(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s-]+/g, "").toUpperCase();
  return compact || null;
}

export function normalizeIsbn13(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s-]+/g, "");
  return compact || null;
}

/**
 * Normalize to a valid Goodreads ID (numeric only). Rejects Amazon/Kindle
 * identifiers (e.g. kca://book/amzn1) that Goodreads may return for some editions.
 */
export function normalizeGoodreadsId(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  // Extract leading digits — real Goodreads IDs are numeric, but may be
  // followed by a slug (e.g. "12345.My-Book" or "12345-my-book").
  // Rejects non-numeric values like "kca://book/amzn1" (Kindle Content Address).
  const match = normalized.match(/^(\d+)/);
  return match ? (match[1] ?? null) : null;
}

function parseMeta(meta: string | null): ParsedMeta {
  if (!meta) {
    return {};
  }

  try {
    const parsed = JSON.parse(meta) as ParsedMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractGoodreadsId(book: BookIdentifiersSource): string | null {
  if (book.source === "Goodreads") {
    const fromSourceId = normalizeGoodreadsId(book.sourceId);
    if (fromSourceId) {
      return fromSourceId;
    }
  }

  const sourceUrl = normalizeString(book.sourceUrl);
  if (!sourceUrl) {
    return null;
  }

  const match = sourceUrl.match(GOODREADS_BOOK_PATH_REGEX);
  if (!match?.[1]) {
    return null;
  }

  return normalizeGoodreadsId(match[1]);
}

export function normalizeOlWorkId(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  // Accept "OL45883W" or a trailing path like "/works/OL45883W".
  const match = normalized.match(/(OL[0-9]+W)\b/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function deriveBookIdentifiers(
  book: BookIdentifiersSource,
  overrides: { olWorkId?: string | null } = {},
): Omit<BookIdentifiersRow, "updatedAt"> {
  const meta = parseMeta(book.meta);
  return {
    hiveId: book.id,
    isbn: normalizeIsbn(typeof meta.isbn === "string" ? meta.isbn : null),
    isbn13: normalizeIsbn13(typeof meta.isbn13 === "string" ? meta.isbn13 : null),
    goodreadsId: extractGoodreadsId(book),
    olWorkId: normalizeOlWorkId(overrides.olWorkId ?? null),
  };
}

/**
 * Map a book_id_map row (or derived identifiers) to the bookIdentifiers lexicon shape for API output.
 */
export function toBookIdentifiersOutput(
  row: Omit<BookIdentifiersRow, "updatedAt"> | undefined,
): BookIdentifiers {
  if (!row) {
    return {};
  }
  return {
    hiveId: row.hiveId,
    isbn10: row.isbn ?? undefined,
    isbn13: row.isbn13 ?? undefined,
    goodreadsId: row.goodreadsId ?? undefined,
    openLibraryId: row.olWorkId ?? undefined,
  };
}

export async function upsertBookIdentifiers(
  db: Database,
  book: BookIdentifiersSource,
  overrides: { olWorkId?: string | null } = {},
) {
  const identifiers = deriveBookIdentifiers(book, overrides);
  const updatedAt = new Date().toISOString();

  await db
    .insertInto("book_id_map")
    .values({
      hiveId: identifiers.hiveId,
      isbn: identifiers.isbn,
      isbn13: identifiers.isbn13,
      goodreadsId: identifiers.goodreadsId,
      olWorkId: identifiers.olWorkId,
      updatedAt,
    })
    .onConflict((oc) =>
      oc.column("hiveId").doUpdateSet((eb) => ({
        isbn: eb.ref("excluded.isbn"),
        isbn13: eb.ref("excluded.isbn13"),
        goodreadsId: eb.ref("excluded.goodreadsId"),
        // Preserve a previously-stored olWorkId if the new derive doesn't
        // include one — most callers don't pass it through, so writing a
        // bare null on conflict would clobber prior enrichment.
        olWorkId: sql<string | null>`COALESCE(excluded.olWorkId, book_id_map.olWorkId)`,
        updatedAt: eb.ref("excluded.updatedAt"),
      })),
    )
    .execute();
}

export async function upsertBookIdentifiersBatch(db: Database, books: BookIdentifiersSource[]) {
  if (!books.length) {
    return;
  }

  const updatedAt = new Date().toISOString();
  const values = books.map((book) => {
    const identifiers = deriveBookIdentifiers(book);
    return {
      hiveId: identifiers.hiveId,
      isbn: identifiers.isbn,
      isbn13: identifiers.isbn13,
      goodreadsId: identifiers.goodreadsId,
      olWorkId: identifiers.olWorkId,
      updatedAt,
    };
  });

  await db
    .insertInto("book_id_map")
    .values(values)
    .onConflict((oc) =>
      oc.column("hiveId").doUpdateSet((eb) => ({
        isbn: eb.ref("excluded.isbn"),
        isbn13: eb.ref("excluded.isbn13"),
        goodreadsId: eb.ref("excluded.goodreadsId"),
        olWorkId: sql<string | null>`COALESCE(excluded.olWorkId, book_id_map.olWorkId)`,
        updatedAt: eb.ref("excluded.updatedAt"),
      })),
    )
    .execute();
}
