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
import { enrichQueueDepth, LABEL } from "../metrics";

/** Items drained at once. One slot below SOLVER_POOL_SIZE, so an interactive
 *  force-refresh always has a worker available. */
export const ENRICH_CONCURRENCY = 3;
const DRAIN_INTERVAL_MS = 5_000;
/** A claim older than this is assumed to belong to a dead process. */
const CLAIM_STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;
/**
 * How long a book that exhausted its attempts stays out of the queue.
 *
 * Not a permanent tombstone: most failures are Goodreads' WAF being up, which
 * is transient on a scale of days. But it must be long enough that a crawler
 * walking all 356k books cannot re-add the same failures on its next pass.
 */
export const ENRICH_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Backoff per attempt number (1-indexed); the last value repeats. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0]!;
}

/** Queue a book for enrichment. Cheap, idempotent, safe from any process. */
export async function enqueueEnrichment(db: Database, hiveId: HiveId): Promise<void> {
  await enqueueEnrichmentBatch(db, [hiveId]);
}

/**
 * Queue several books in one statement. Already-queued ids are left untouched
 * so an in-progress item doesn't get its backoff reset by a page view.
 *
 * Books that exhausted their attempts inside `ENRICH_RETRY_AFTER_MS` are
 * filtered out **here** rather than at each call site. Every caller is a read
 * path reached by crawler traffic — a book page view, a search, an XRPC read —
 * and each one previously re-added books that had already failed four times.
 * One shared gate is the only version of this that cannot regress when a new
 * call site is added.
 */
export async function enqueueEnrichmentBatch(db: Database, hiveIds: HiveId[]): Promise<void> {
  if (hiveIds.length === 0) return;
  const now = new Date().toISOString();
  const unique = [...new Set(hiveIds)];

  const cooling = await db
    .selectFrom("hive_book")
    .select("id")
    .where("id", "in", unique)
    .where("enrichFailedAt", "is not", null)
    .where("enrichFailedAt", ">", new Date(Date.now() - ENRICH_RETRY_AFTER_MS).toISOString())
    .execute();

  const eligible =
    cooling.length === 0 ? unique : unique.filter((id) => !cooling.some((row) => row.id === id));
  if (eligible.length === 0) return;

  await db
    .insertInto("enrich_queue")
    .values(
      eligible.map((hiveId) => ({
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
    await reschedule(db, logger, item.hiveId, attempts, error);
  } catch (err) {
    outcome = "error";
    error = err instanceof Error ? err.message : String(err);
    await reschedule(db, logger, item.hiveId, attempts, error).catch(() => {});
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
  logger: Logger,
  hiveId: HiveId,
  attempts: number,
  lastError: string | undefined,
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    // Stamp the book before dropping the queue row. Deleting the row alone was
    // not a terminal state: `enrichedAt` stays null on failure, so the next
    // page view re-enqueued the book and the queue never converged.
    await db
      .updateTable("hive_book")
      .set({ enrichAttempts: attempts, enrichFailedAt: new Date().toISOString() })
      .where("id", "=", hiveId)
      .execute();
    await db.deleteFrom("enrich_queue").where("hiveId", "=", hiveId).execute();
    logger.info({
      msg: "enrichment_exhausted",
      hiveId,
      attempts,
      retry_after_days: ENRICH_RETRY_AFTER_MS / 86_400_000,
      ...(lastError ? { error: lastError } : {}),
    });
    return;
  }
  await db
    .updateTable("hive_book")
    .set({ enrichAttempts: attempts })
    .where("id", "=", hiveId)
    .execute();
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

/** How often the drainer proves it is alive and republishes queue depth. */
const HEARTBEAT_MS = 60_000;

/**
 * Publish queue depth to /metrics and emit a heartbeat.
 *
 * Only the primary worker drains (see `isPrimaryWorker`), which makes the
 * drainer a silent single point of failure: with no periodic signal, a
 * crash-looping worker 0 is indistinguishable from an idle queue — an absence
 * of `msg: "enrichment"` events means nothing either way. The heartbeat turns
 * that into an alertable absence.
 */
export async function publishEnrichQueueStats(db: Database, logger: Logger): Promise<void> {
  const stats = await db
    .selectFrom("enrich_queue")
    .select((eb) => [
      eb.fn.countAll().as("total"),
      eb.fn.count("claimedAt").as("claimed"),
      eb.fn.max("attempts").as("maxAttempts"),
    ])
    .executeTakeFirst();

  const exhausted = await db
    .selectFrom("enrich_queue")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("attempts", ">=", MAX_ATTEMPTS)
    .executeTakeFirst();

  const total = Number(stats?.total ?? 0);
  const claimed = Number(stats?.claimed ?? 0);
  const exhaustedCount = Number(exhausted?.count ?? 0);

  enrichQueueDepth.set(total, LABEL.enrichQueue.total);
  enrichQueueDepth.set(claimed, LABEL.enrichQueue.claimed);
  enrichQueueDepth.set(exhaustedCount, LABEL.enrichQueue.exhausted);

  logger.info({
    msg: "enrich_drainer_heartbeat",
    depth: total,
    claimed,
    exhausted: exhaustedCount,
    max_attempts: Number(stats?.maxAttempts ?? 0),
  });
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
      .then(async (processed) => {
        if (processed === 0) return;
        // Backlog is otherwise invisible: nothing else reports queue depth, and
        // a stalled drain looks identical to an empty queue.
        const depth = await db
          .selectFrom("enrich_queue")
          .select((eb) => eb.fn.countAll().as("count"))
          .executeTakeFirst();
        logger.info({
          msg: "enrichment_queue",
          processed,
          depth: Number(depth?.count ?? 0),
        });
      })
      .catch((err) => {
        logger.error({ err }, "enrichment queue drain failed");
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();

  const heartbeat = setInterval(() => {
    if (stopped) return;
    void publishEnrichQueueStats(db, logger).catch((err) => {
      logger.error({ err }, "enrich queue heartbeat failed");
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(heartbeat);
  };
}
