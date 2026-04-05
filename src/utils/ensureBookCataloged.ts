import type { ImportContext } from "../workers/import/types";
import type { HiveId } from "../types";
import { enrichBookWithDetailedData } from "./enrichBookData";
import { writeCatalogBookIfNeeded } from "./catalogBookService";

const ENRICH_TIMEOUT_MS = 30_000;
const CATALOG_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Safety net called immediately before writing a book to a user's PDS.
 *
 * Fast path (expected): book already has hiveBookAtUri (set by backfill or searchBooks
 * pipeline) — returns immediately after one DB read with no network calls.
 *
 * Slow path (last resort): if the book somehow slipped through the primary sync
 * mechanisms, enriches it (if needed) then catalogs it before returning the URI.
 * Both steps use timeouts so they never block the user's PDS write indefinitely.
 *
 * Returns the hiveBookAtUri, or undefined if the service account is unavailable
 * or any step fails/times out (PDS write will proceed without hiveBookUri).
 */
export async function ensureBookCataloged(
  ctx: ImportContext,
  hiveId: HiveId,
): Promise<string | undefined> {
  if (!ctx.serviceAccountAgent) return undefined;

  const book = await ctx.db
    .selectFrom("hive_book")
    .selectAll()
    .where("id", "=", hiveId)
    .executeTakeFirst();

  if (!book) return undefined;

  // Fast path: already cataloged — the common case via backfill/searchBooks pipeline
  if (book.hiveBookAtUri) return book.hiveBookAtUri;

  // Slow path: missed by primary sync mechanisms, handle as a last resort
  try {
    if (!book.enrichedAt) {
      await withTimeout(
        enrichBookWithDetailedData(book, ctx),
        ENRICH_TIMEOUT_MS,
        `enrich book ${hiveId}`,
      );
    }

    await withTimeout(
      writeCatalogBookIfNeeded(
        { db: ctx.db, serviceAccountAgent: ctx.serviceAccountAgent },
        hiveId,
      ),
      CATALOG_TIMEOUT_MS,
      `catalog book ${hiveId}`,
    );
  } catch (err) {
    ctx.addWideEventContext({
      ensure_book_cataloged_fallback: "failed",
      hiveId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const updated = await ctx.db
    .selectFrom("hive_book")
    .select("hiveBookAtUri")
    .where("id", "=", hiveId)
    .executeTakeFirst();

  return updated?.hiveBookAtUri ?? undefined;
}
