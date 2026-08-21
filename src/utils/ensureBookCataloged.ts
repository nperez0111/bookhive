import type { BookUtilContext } from "../context";
import type { HiveId } from "../types";
import { enrichBookWithDetailedData } from "./enrichBookData";
import { writeCatalogBookIfNeeded } from "./catalogBookService";
import { enqueueEnrichment } from "./enrichQueue";
import { withTimeout } from "./semaphore";

// Bounds how long *this caller* waits on the fallback scrape before giving up
// and letting the user's PDS write proceed. It does not bound the enrichment
// itself — that keeps running under its own 45s deadline.
const ENRICH_TIMEOUT_MS = 10_000;
const CATALOG_TIMEOUT_MS = 10_000;

/** Fast path only — a status click must never wait on a scrape. The follow-up runs the rest. */
export async function getCatalogedBookUri(
  ctx: Pick<BookUtilContext, "db" | "serviceAccountAgent">,
  hiveId: HiveId,
): Promise<string | undefined> {
  if (!ctx.serviceAccountAgent) return undefined;
  const row = await ctx.db
    .selectFrom("hive_book")
    .select("hiveBookAtUri")
    .where("id", "=", hiveId)
    .executeTakeFirst();
  return row?.hiveBookAtUri ?? undefined;
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
  ctx: BookUtilContext,
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
      try {
        await withTimeout(
          enrichBookWithDetailedData(book, ctx),
          ENRICH_TIMEOUT_MS,
          `enrich book ${hiveId}`,
        );
      } catch (err) {
        // We stopped waiting, but the book still needs enriching — hand it to
        // the queue so the primary worker retries it out of band.
        ctx.addWideEventContext({
          ensure_book_cataloged_enrich: "timed_out",
          hiveId,
          error: err instanceof Error ? err.message : String(err),
        });
        await enqueueEnrichment(ctx.db, hiveId).catch(() => {});
      }
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
