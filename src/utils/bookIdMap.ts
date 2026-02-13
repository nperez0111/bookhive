import type { Database } from "../db";
import type { BookIdMap, HiveBook, HiveId } from "../types";

type BookIdMapSource = Pick<
  HiveBook,
  "id" | "source" | "sourceId" | "sourceUrl" | "meta"
>;

type ParsedMeta = {
  isbn?: unknown;
  isbn13?: unknown;
};

const GOODREADS_BOOK_PATH_REGEX = /\/book\/show\/([^/?#]+)/i;

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeHiveId(
  value: string | null | undefined,
): HiveId | null {
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

export function normalizeIsbn13(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s-]+/g, "");
  return compact || null;
}

export function normalizeGoodreadsId(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  // Goodreads ids can appear as "12345.title-slug"
  const [id] = normalized.split(".", 1);
  return id || null;
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

function extractGoodreadsId(book: BookIdMapSource): string | null {
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

export function deriveBookIdMap(
  book: BookIdMapSource,
): Omit<BookIdMap, "updatedAt"> {
  const meta = parseMeta(book.meta);
  return {
    hiveId: book.id,
    isbn: normalizeIsbn(typeof meta.isbn === "string" ? meta.isbn : null),
    isbn13: normalizeIsbn13(
      typeof meta.isbn13 === "string" ? meta.isbn13 : null,
    ),
    goodreadsId: extractGoodreadsId(book),
  };
}

export function toBookIdMapOutput(bookIdMap: Omit<BookIdMap, "updatedAt">) {
  return {
    hiveId: bookIdMap.hiveId,
    isbn: bookIdMap.isbn ?? undefined,
    isbn13: bookIdMap.isbn13 ?? undefined,
    goodreadsId: bookIdMap.goodreadsId ?? undefined,
  };
}

export async function upsertBookIdMap(db: Database, book: BookIdMapSource) {
  const map = deriveBookIdMap(book);
  const updatedAt = new Date().toISOString();

  await db
    .insertInto("book_id_map")
    .values({
      hiveId: map.hiveId,
      isbn: map.isbn,
      isbn13: map.isbn13,
      goodreadsId: map.goodreadsId,
      updatedAt,
    })
    .onConflict((oc) =>
      oc.column("hiveId").doUpdateSet((eb) => ({
        isbn: eb.ref("excluded.isbn"),
        isbn13: eb.ref("excluded.isbn13"),
        goodreadsId: eb.ref("excluded.goodreadsId"),
        updatedAt: eb.ref("excluded.updatedAt"),
      })),
    )
    .execute();
}

export async function upsertBookIdMaps(db: Database, books: BookIdMapSource[]) {
  if (!books.length) {
    return;
  }

  const updatedAt = new Date().toISOString();
  const values = books.map((book) => {
    const map = deriveBookIdMap(book);
    return {
      hiveId: map.hiveId,
      isbn: map.isbn,
      isbn13: map.isbn13,
      goodreadsId: map.goodreadsId,
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
        updatedAt: eb.ref("excluded.updatedAt"),
      })),
    )
    .execute();
}
