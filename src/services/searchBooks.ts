/**
 * The one "make sure this book exists in our catalogue", and the one bound on
 * how many of those may be in flight — every caller gets the same concurrency
 * ceiling. `warmCatalogSearch` is the only spelling of fire-and-forget cache
 * warming and it cannot be called unbounded, which is what protects against
 * the unbounded per-book fan-out that once caused OOM kills.
 */
import { sql } from "kysely";

import type { AppContext } from "../context";
import type { HiveId } from "../types";
import { readThroughCache } from "../lib/readThroughCache";
import { findBookDetails } from "../scrapers";
import { enqueueEnrichmentBatch } from "../data/enrichQueue";
import { upsertBookIdentifiersBatch } from "../data/bookIdentifiers";
import { Semaphore } from "../lib/semaphore";
import { ftsMatchQuery, isUsefulFtsQuery } from "../core/ftsQuery";
import { errorMessage } from "../lib/errors";

export type SearchBooksContext = Pick<AppContext, "db" | "kv" | "addWideEventContext"> & {
  serviceAccountAgent?: AppContext["serviceAccountAgent"];
};

// Concurrency ceiling for the per-book searches a library re-sync fans out.
// Matches SEARCH_CONCURRENCY in src/workers/import/logic.ts.
const REFETCH_SEARCH_CONCURRENCY = 3;
/**
 * `maxPending`/`acquireTimeoutMs` are finite on purpose: the semaphore is
 * module-scoped and shared across concurrent re-syncs, so shedding past that
 * point is correct — these searches are best-effort cache warming, not part
 * of the response.
 */
const searchSlots = new Semaphore(REFETCH_SEARCH_CONCURRENCY, {
  label: "refetch_search",
  maxPending: 500,
  acquireTimeoutMs: 60_000,
});

export async function searchBooks({
  query,
  ctx,
}: {
  query: string;
  ctx: Pick<AppContext, "db" | "kv" | "addWideEventContext"> & {
    serviceAccountAgent?: AppContext["serviceAccountAgent"];
  };
}) {
  const combinedIds = await readThroughCache<HiveId[]>(
    ctx.kv,
    `search:${query}`,
    async () => {
      let goodreadsIds: HiveId[] = [];

      const res = await findBookDetails(query);
      if (res.success) {
        goodreadsIds = await ctx.db
          .insertInto("hive_book")
          .values(res.data)
          .onConflict((oc) =>
            oc.column("id").doUpdateSet((c) => {
              return {
                rating: c.ref("excluded.rating"),
                ratingsCount: c.ref("excluded.ratingsCount"),
                updatedAt: c.ref("excluded.updatedAt"),
                rawTitle: c.ref("excluded.rawTitle"),
              };
            }),
          )
          .execute()
          .then(() => res.data.map((book) => book.id));

        try {
          await upsertBookIdentifiersBatch(ctx.db, res.data);
        } catch (error) {
          ctx.addWideEventContext({
            search_book_identifiers_persist: "failed",
            error: errorMessage(error),
          });
        }

        // Queue enrichment instead of scraping here — fanning out a solver
        // Worker per result with dropped promises previously caused OOM kills.
        try {
          await enqueueEnrichmentBatch(
            ctx.db,
            res.data.map((book) => book.id),
          );
        } catch (error) {
          // Distinct key: the identifier-persist failure above also reports
          // through `error`, and the last writer would win.
          ctx.addWideEventContext({
            enrichment_enqueue: "failed",
            enrichment_enqueue_error: errorMessage(error),
          });
        }
      }

      // Backfill from the local DB to reach up to 20 results, via the FTS5
      // index (migration 019) rather than a `LIKE` scan.
      const match = isUsefulFtsQuery(query) ? ftsMatchQuery(query) : null;
      const dbRows = match
        ? (
            await sql<{ id: HiveId }>`
              SELECT b.id
              FROM hive_book_fts f
              JOIN hive_book b ON b.rowid = f.rowid
              WHERE hive_book_fts MATCH ${match}
              ORDER BY b.ratingsCount DESC, b.rating DESC
              LIMIT 20
            `.execute(ctx.db)
          ).rows
        : [];

      const combined = [...goodreadsIds];
      for (const { id } of dbRows) {
        if (combined.length >= 20) break;
        if (!combined.includes(id)) combined.push(id);
      }

      return combined;
    },
    [] as HiveId[],
    {
      requestsPerSecond: 5,
    },
  );

  return combinedIds;
}

/**
 * Fire-and-forget catalogue warming, bounded and swallowed.
 *
 * Every caller that does not await the result must come through here. The
 * result is discarded by design — the search runs to populate `hive_book`, and
 * letting one Goodreads timeout (or a shed slot) reject would abort whatever
 * batch it was queued alongside.
 */
export function warmCatalogSearch(query: string, ctx: SearchBooksContext): Promise<unknown> {
  return searchSlots.run(() => searchBooks({ query, ctx })).catch(() => null);
}
