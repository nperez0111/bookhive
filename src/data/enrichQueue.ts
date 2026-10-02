/**
 * Durable work queue for Goodreads enrichment.
 *
 * Enrichment used to run inline on user-facing requests with unbounded
 * fan-out, which caused a production OOM incident. Now any process can
 * `enqueueEnrichment()` and only the primary worker drains the queue (see
 * `startEnrichmentDrain`, wired in `src/context.ts`).
 *
 * Each item emits exactly one terminal `msg: "enrichment"` log line — detached
 * work can't report through the request's wide-event bag, since that bag is
 * already flushed by the time enrichment runs.
 */

import type { Logger } from "pino";

import type { Database } from "../db";
import type { HiveId } from "../types";
import { verdictKindFrom, type EnrichVerdictKind } from "../core/enrichVerdict";
import { enrichBookWithDetailedData } from "../services/enrichBookData";
import { enrichQueueDepth, LABEL } from "../metrics";
import { errorMessage } from "../lib/errors";

/** Items drained at once — with DRAIN_INTERVAL_MS this is also the only rate limit on Goodreads requests; nothing downstream needs a second one. */
export const ENRICH_CONCURRENCY = 3;
const DRAIN_INTERVAL_MS = 5_000;
/** A claim older than this is assumed to belong to a dead process. */
const CLAIM_STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;
/** How long a book that exhausted its attempts stays out of the queue — not a permanent tombstone, but long enough that a crawler can't re-add the same failures on its next pass. */
export const ENRICH_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Backoff per attempt number (1-indexed); the last value repeats. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0]!;
}

/**
 * What the last run told us about the book. `attempts` counts answers from
 * Goodreads, not failures — an omission used to burn an attempt for a refusal
 * the app generated itself without sending a request.
 *
 * The verdict type and bag encoding live in `core/enrichVerdict.ts`, shared by
 * every producer and this consumer.
 */
export type EnrichDisposition = EnrichVerdictKind;
const dispositionOf = verdictKindFrom;

/** How long a deferred book waits before its next free attempt. */
const DEFER_BASE_MS = 15 * 60_000;
const DEFER_MAX_MS = 6 * 60 * 60_000;
const DEFER_JITTER = 0.2;

/**
 * Deferred books retry on a decaying schedule based on how long they've been
 * queued, since defers are free and a flat retry interval would exhaust the
 * drain's rate limit against a large stuck backlog.
 *
 * Jittered so books deferred by the same incident don't all come due at once.
 */
function deferFor(enqueuedAt: string): number {
  const ageHours = (Date.now() - Date.parse(enqueuedAt)) / 3_600_000;
  const doublings = Math.min(Math.max(Math.floor(ageHours), 0), 10);
  const delay = Math.min(DEFER_BASE_MS * 2 ** doublings, DEFER_MAX_MS);
  return Math.round(delay * (1 + (Math.random() * 2 - 1) * DEFER_JITTER));
}

/**
 * Ceiling on how long a book may sit in the queue, however it got there —
 * without it a permanent outage would park rows forever. `enqueuedAt` survives
 * re-enqueue, since the insert conflicts on the primary key and does nothing.
 */
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Queue a book for enrichment. Cheap, idempotent, safe from any process. */
export async function enqueueEnrichment(db: Database, hiveId: HiveId): Promise<void> {
  await enqueueEnrichmentBatch(db, [hiveId]);
}

/**
 * Queue several books in one statement. Already-queued ids are left untouched
 * so an in-progress item doesn't get its backoff reset by a page view.
 *
 * Books that exhausted their attempts inside `ENRICH_RETRY_AFTER_MS` are
 * filtered out here rather than at each call site, so a new call site can't
 * regress this.
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
    .select(["hiveId", "attempts", "enqueuedAt"])
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
  item: { hiveId: HiveId; attempts: number; enqueuedAt: string },
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

    // enrichBookWithDetailedData never throws — it reports through the context bag; treat anything that didn't land as a retryable failure.
    outcome =
      typeof fields["enrichment"] === "string" ? (fields["enrichment"] as string) : "completed";

    if (outcome === "completed" || outcome === "skipped") {
      await db.deleteFrom("enrich_queue").where("hiveId", "=", item.hiveId).execute();
      return;
    }

    error = typeof fields["scrape_failure"] === "string" ? fields["scrape_failure"] : outcome;
    await reschedule(db, logger, item, attempts, error, dispositionOf(fields));
  } catch (err) {
    outcome = "error";
    error = errorMessage(err);
    // A throw out of the drainer itself is our bug, not the book's — defer.
    await reschedule(db, logger, item, attempts, error, "defer").catch(() => {});
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
  item: { hiveId: HiveId; attempts: number; enqueuedAt: string },
  attempts: number,
  lastError: string | undefined,
  disposition: EnrichDisposition,
): Promise<void> {
  const { hiveId } = item;
  const expired = Date.now() - Date.parse(item.enqueuedAt) > MAX_QUEUE_AGE_MS;
  const spent = disposition === "retry" ? attempts : item.attempts;

  if (disposition === "dead" || expired || (disposition === "retry" && attempts >= MAX_ATTEMPTS)) {
    // Stamp the book before dropping the queue row — deleting alone isn't terminal, since enrichedAt stays null and the next page view would just re-enqueue it.
    await db
      .updateTable("hive_book")
      .set({ enrichAttempts: spent, enrichFailedAt: new Date().toISOString() })
      .where("id", "=", hiveId)
      .execute();
    await db.deleteFrom("enrich_queue").where("hiveId", "=", hiveId).execute();
    logger.info({
      msg: "enrichment_exhausted",
      hiveId,
      attempts: spent,
      reason: disposition === "dead" ? "dead" : expired ? "queue_age" : "attempts",
      retry_after_days: ENRICH_RETRY_AFTER_MS / 86_400_000,
      ...(lastError ? { error: lastError } : {}),
    });
    return;
  }

  if (disposition === "defer") {
    // No answer, so no attempt spent and hive_book left alone; MAX_QUEUE_AGE_MS above ends it if the cause never clears.
    await db
      .updateTable("enrich_queue")
      .set({
        claimedAt: null,
        nextAttemptAt: new Date(Date.now() + deferFor(item.enqueuedAt)).toISOString(),
        lastError: lastError ?? null,
      })
      .where("hiveId", "=", hiveId)
      .execute();
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
 * Only the primary worker drains, which makes it a silent single point of
 * failure — with no periodic signal, a crash-looping worker 0 looks identical
 * to an idle queue. The heartbeat turns that into an alertable absence.
 */
export async function publishEnrichQueueStats(db: Database, logger: Logger): Promise<void> {
  const nowIso = new Date().toISOString();
  const stats = await db
    .selectFrom("enrich_queue")
    .select((eb) => [
      eb.fn.countAll().as("total"),
      eb.fn.count("claimedAt").as("claimed"),
      eb.fn.max("attempts").as("maxAttempts"),
      // Books waiting out a defer — blocked on something that isn't their fault; replaced circuit_open as the signal that fetching is in trouble.
      eb.fn.count(eb.case().when("nextAttemptAt", ">", nowIso).then(1).end()).as("deferred"),
    ])
    .executeTakeFirst();

  // Counted on `hive_book`, not `enrich_queue`: an exhausted row is deleted from the queue in the same call that stamps `enrichFailedAt` (see `reschedule`), so querying enrich_queue for max-attempts rows would always match nothing.
  const exhausted = await db
    .selectFrom("hive_book")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("enrichFailedAt", "is not", null)
    .where("enrichFailedAt", ">", new Date(Date.now() - ENRICH_RETRY_AFTER_MS).toISOString())
    .executeTakeFirst();

  const total = Number(stats?.total ?? 0);
  const claimed = Number(stats?.claimed ?? 0);
  const deferred = Number(stats?.deferred ?? 0);
  const exhaustedCount = Number(exhausted?.count ?? 0);

  enrichQueueDepth.set(total, LABEL.enrichQueue.total);
  enrichQueueDepth.set(claimed, LABEL.enrichQueue.claimed);
  enrichQueueDepth.set(deferred, LABEL.enrichQueue.deferred);
  enrichQueueDepth.set(exhaustedCount, LABEL.enrichQueue.exhausted);

  logger.info({
    msg: "enrich_drainer_heartbeat",
    depth: total,
    claimed,
    deferred,
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
        // Backlog is otherwise invisible — nothing else reports queue depth, and a stalled drain looks identical to an empty queue.
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
