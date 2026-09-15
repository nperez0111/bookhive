import type { BookUtilContext } from "../context";
import type { HiveId } from "../types";
import { enrichBookWithDetailedData } from "./enrichBookData";
import { writeCatalogBookIfNeeded } from "./catalogBookService";
import { enqueueEnrichment } from "../data/enrichQueue";
import { withTimeout } from "../lib/semaphore";
import { errorMessage } from "../lib/errors";

// Bounds how long this caller waits on the fallback scrape before letting the
// PDS write proceed; the enrichment itself keeps running under its own deadline.
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
 * Fast path: book already has hiveBookAtUri (set by backfill or searchBooks) —
 * one DB read, no network calls.
 * Slow path: if it slipped through primary sync, enriches then catalogs it,
 * both under timeouts so the PDS write is never blocked indefinitely.
 * Returns undefined if the service account is unavailable or any step
 * fails/times out — the PDS write proceeds without hiveBookUri either way.
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

  if (book.hiveBookAtUri) return book.hiveBookAtUri;

  try {
    if (!book.enrichedAt) {
      try {
        await withTimeout(
          enrichBookWithDetailedData(book, ctx),
          ENRICH_TIMEOUT_MS,
          `enrich book ${hiveId}`,
        );
      } catch (err) {
        // Stopped waiting, but still needs enriching — hand it to the queue for retry out of band.
        ctx.addWideEventContext({
          ensure_book_cataloged_enrich: "timed_out",
          hiveId,
          error: errorMessage(err),
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
      error: errorMessage(err),
    });
  }

  const updated = await ctx.db
    .selectFrom("hive_book")
    .select("hiveBookAtUri")
    .where("id", "=", hiveId)
    .executeTakeFirst();

  return updated?.hiveBookAtUri ?? undefined;
}
