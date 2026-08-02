/**
 * Durable work queue for Goodreads enrichment.
 *
 * Before this existed, enrichment ran inline on user-facing requests: a single
 * `/search` fanned out 20 concurrent scrapes (`src/routes/lib.ts`), each
 * spawning a WAF solver Worker, across all four cluster processes. That
 * unbounded fan-out is what grew worker heaps to ~2 GB and produced the
 * 2026-08-01 OOM storm.
 *
 * Now any process can `enqueueEnrichment()` — one INSERT OR IGNORE, no network —
 * and only the **primary worker** drains the queue (see `startEnrichmentDrain`,
 * wired in `src/context.ts` alongside the ingester). That gives one WAF token
 * cache instead of four, one writer instead of four, and work that survives a
 * process restart.
 *
 * Each item emits exactly one terminal `msg: "enrichment"` log line. The old
 * code reported through `addWideEventContext`, which writes into the *request's*
 * wide-event bag — for detached work that bag has already been flushed, which is
 * why ~4,200 enrichments a day appeared to start and never finish.
 */

import type { Logger } from "pino";

import type { Database } from "../db";
import type { HiveId } from "../types";
import { enrichBookWithDetailedData } from "./enrichBookData";

/** Items drained at once. One slot below SOLVER_POOL_SIZE, so an interactive
 *  force-refresh always has a worker available. */
export const ENRICH_CONCURRENCY = 3;
const DRAIN_INTERVAL_MS = 5_000;
/** A claim older than this is assumed to belong to a dead process. */
const CLAIM_STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;
/** Backoff per attempt number (1-indexed); the last value repeats. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0]!;
}

/** Queue a book for enrichment. Cheap, idempotent, safe from any process. */
export async function enqueueEnrichment(db: Database, hiveId: HiveId): Promise<void> {
  await enqueueEnrichmentBatch(db, [hiveId]);
}

/** Queue several books in one statement. Already-queued ids are left untouched
 *  so an in-progress item doesn't get its backoff reset by a page view. */
export async function enqueueEnrichmentBatch(db: Database, hiveIds: HiveId[]): Promise<void> {
  if (hiveIds.length === 0) return;
  const now = new Date().toISOString();
  const unique = [...new Set(hiveIds)];

  await db
    .insertInto("enrich_queue")
    .values(
      unique.map((hiveId) => ({
        hiveId,
        enqueuedAt: now,
        attempts: 0,
        nextAttemptAt: now,
        claimedAt: null,
        lastError: null,
      })),
    )
    .onConflict((oc) => oc.column("hiveId").doNothing())
    .execute();
}

async function claimBatch(db: Database, limit: number) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const staleCutoff = new Date(now - CLAIM_STALE_MS).toISOString();

  // Release claims from a process that died mid-item.
  await db
    .updateTable("enrich_queue")
    .set({ claimedAt: null })
    .where("claimedAt", "is not", null)
    .where("claimedAt", "<", staleCutoff)
    .execute();

  const ready = await db
    .selectFrom("enrich_queue")
    .select(["hiveId", "attempts"])
    .where("claimedAt", "is", null)
    .where("nextAttemptAt", "<=", nowIso)
    .orderBy("nextAttemptAt", "asc")
    .limit(limit)
    .execute();

  if (ready.length === 0) return [];

  await db
    .updateTable("enrich_queue")
    .set({ claimedAt: nowIso })
    .where(
      "hiveId",
      "in",
      ready.map((r) => r.hiveId),
    )
    .execute();

  return ready;
}

/** Injectable for tests; production always uses enrichBookWithDetailedData. */
export type EnrichFn = typeof enrichBookWithDetailedData;

async function runItem(
  db: Database,
  logger: Logger,
  item: { hiveId: HiveId; attempts: number },
  enrich: EnrichFn,
): Promise<void> {
  const startedAt = Date.now();
  const fields: Record<string, unknown> = {};
  const attempts = item.attempts + 1;
  let outcome = "completed";
  let error: string | undefined;

  try {
    const book = await db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", item.hiveId)
      .executeTakeFirst();

    if (!book) {
      outcome = "book_missing";
      await db.deleteFrom("enrich_queue").where("hiveId", "=", item.hiveId).execute();
      return;
    }

    await enrich(book, {
      db,
      addWideEventContext: (ctx) => Object.assign(fields, ctx),
    });

    // enrichBookWithDetailedData never throws; it reports through the context
    // bag. Treat anything that didn't land as a retryable failure.
    outcome =
      typeof fields["enrichment"] === "string" ? (fields["enrichment"] as string) : "completed";

    if (outcome === "completed" || outcome === "skipped") {
      await db.deleteFrom("enrich_queue").where("hiveId", "=", item.hiveId).execute();
      return;
    }

    error = typeof fields["scrape_failure"] === "string" ? fields["scrape_failure"] : outcome;
    await reschedule(db, item.hiveId, attempts, error);
  } catch (err) {
    outcome = "error";
    error = err instanceof Error ? err.message : String(err);
    await reschedule(db, item.hiveId, attempts, error).catch(() => {});
  } finally {
    // The one terminal event per item. Never skipped, on any path.
    logger.info({
      msg: "enrichment",
      hiveId: item.hiveId,
      outcome,
      attempts,
      duration_ms: Date.now() - startedAt,
      ...(error ? { error } : {}),
      ...fields,
    });
  }
}

async function reschedule(
  db: Database,
  hiveId: HiveId,
  attempts: number,
  lastError: string | undefined,
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await db.deleteFrom("enrich_queue").where("hiveId", "=", hiveId).execute();
    return;
  }
  await db
    .updateTable("enrich_queue")
    .set({
      attempts,
      claimedAt: null,
      nextAttemptAt: new Date(Date.now() + backoffFor(attempts)).toISOString(),
      lastError: lastError ?? null,
    })
    .where("hiveId", "=", hiveId)
    .execute();
}

/** Drain one batch. Exported for tests; the interval below is the production path. */
export async function drainEnrichmentQueue(
  db: Database,
  logger: Logger,
  options: { limit?: number; enrich?: EnrichFn } = {},
): Promise<number> {
  const { limit = ENRICH_CONCURRENCY, enrich = enrichBookWithDetailedData } = options;
  const items = await claimBatch(db, limit);
  if (items.length === 0) return 0;
  await Promise.all(items.map((item) => runItem(db, logger, item, enrich)));
  return items.length;
}

/**
 * Start the primary-worker drain loop. Returns a stop function for shutdown.
 * Ticks are never overlapped — a slow batch just delays the next one.
 */
export function startEnrichmentDrain({
  db,
  logger,
  intervalMs = DRAIN_INTERVAL_MS,
}: {
  db: Database;
  logger: Logger;
  intervalMs?: number;
}): () => void {
  let running = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void drainEnrichmentQueue(db, logger)
      .catch((err) => {
        logger.error({ err }, "enrichment queue drain failed");
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
