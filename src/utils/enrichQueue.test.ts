import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import type { Logger } from "pino";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import type { HiveId } from "../types";
import {
  drainEnrichmentQueue,
  enqueueEnrichment,
  enqueueEnrichmentBatch,
  publishEnrichQueueStats,
} from "./enrichQueue";
import type { EnrichFn } from "./enrichQueue";

const HIVE_ID = "bk_queued" as HiveId;

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

function makeLogger() {
  const events: Array<Record<string, unknown>> = [];
  const logger = {
    info: (obj: Record<string, unknown>) => events.push(obj),
    error: (obj: Record<string, unknown>) => events.push(obj),
  } as unknown as Logger;
  return { logger, events };
}

async function insertBook(db: Database, id: HiveId, enrichedAt: string | null = null) {
  const now = new Date().toISOString();
  await db
    .insertInto("hive_book")
    .values({
      id,
      title: "A Book",
      authors: "An Author",
      source: "Goodreads",
      sourceUrl: `https://www.goodreads.com/book/show/${id}`,
      thumbnail: "",
      enrichAttempts: 0,
      enrichFailedAt: null,
      createdAt: now,
      updatedAt: now,
      enrichedAt,
    })
    .execute();
}

/** Stand-in for the scraper: reports through the wide-event bag like the real one. */
function fakeEnrich(fields: Record<string, unknown>): EnrichFn {
  return mock(async (_book, ctx) => {
    ctx.addWideEventContext(fields);
  }) as unknown as EnrichFn;
}

describe("enrichQueue", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("dedupes re-enqueues instead of resetting backoff", async () => {
    await enqueueEnrichment(db, HIVE_ID);
    await db
      .updateTable("enrich_queue")
      .set({ attempts: 2, nextAttemptAt: "2099-01-01T00:00:00.000Z" })
      .where("hiveId", "=", HIVE_ID)
      .execute();

    await enqueueEnrichment(db, HIVE_ID);

    const rows = await db.selectFrom("enrich_queue").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.nextAttemptAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("enqueues a batch in one go, ignoring duplicates within it", async () => {
    await enqueueEnrichmentBatch(db, ["bk_a", "bk_b", "bk_a"] as HiveId[]);
    const rows = await db.selectFrom("enrich_queue").select("hiveId").execute();
    expect(rows.map((r) => r.hiveId).sort()).toEqual(["bk_a", "bk_b"]);
  });

  it("is a no-op for an empty batch", async () => {
    await enqueueEnrichmentBatch(db, []);
    const rows = await db.selectFrom("enrich_queue").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("drops a queued id whose book no longer exists", async () => {
    const { logger, events } = makeLogger();
    await enqueueEnrichment(db, "bk_ghost" as HiveId);

    const drained = await drainEnrichmentQueue(db, logger);

    expect(drained).toBe(1);
    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ msg: "enrichment", outcome: "book_missing" });
  });

  it("removes the row and logs one terminal event on success", async () => {
    const { logger, events } = makeLogger();
    await insertBook(db, HIVE_ID);
    await enqueueEnrichment(db, HIVE_ID);

    await drainEnrichmentQueue(db, logger, {
      enrich: fakeEnrich({ enrichment: "completed", genres_count: 3 }),
    });

    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(0);
    const event = events.at(-1)!;
    expect(event).toMatchObject({
      msg: "enrichment",
      hiveId: HIVE_ID,
      outcome: "completed",
      attempts: 1,
    });
    expect(typeof event["duration_ms"]).toBe("number");
  });

  it("reschedules with backoff when the scrape fails", async () => {
    const { logger, events } = makeLogger();
    await insertBook(db, HIVE_ID);
    await enqueueEnrichment(db, HIVE_ID);

    await drainEnrichmentQueue(db, logger, {
      enrich: fakeEnrich({ enrichment: "failed", scrape_failure: "waf_token_ineffective" }),
    });

    const row = await db.selectFrom("enrich_queue").selectAll().executeTakeFirst();
    expect(row).toBeDefined();
    expect(row!.attempts).toBe(1);
    expect(row!.claimedAt).toBeNull();
    expect(new Date(row!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(row!.lastError).toBe("waf_token_ineffective");
    expect(events.at(-1)).toMatchObject({ outcome: "failed", attempts: 1 });
  });

  it("lengthens the backoff on later attempts, then repeats the last step", async () => {
    const { logger } = makeLogger();
    await insertBook(db, HIVE_ID);

    // attempts already recorded -> expected delay before the next try
    const steps: Array<[number, number]> = [
      [0, 60_000], // 1st failure -> 1m
      [1, 5 * 60_000], // 2nd -> 5m
      [2, 30 * 60_000], // 3rd -> 30m
    ];

    for (const [seeded, expectedMs] of steps) {
      await db.deleteFrom("enrich_queue").execute();
      await enqueueEnrichment(db, HIVE_ID);
      await db
        .updateTable("enrich_queue")
        .set({ attempts: seeded })
        .where("hiveId", "=", HIVE_ID)
        .execute();

      const before = Date.now();
      await drainEnrichmentQueue(db, logger, { enrich: fakeEnrich({ enrichment: "failed" }) });

      const row = await db.selectFrom("enrich_queue").selectAll().executeTakeFirstOrThrow();
      const delay = new Date(row.nextAttemptAt).getTime() - before;
      expect(delay).toBeGreaterThanOrEqual(expectedMs - 1_000);
      expect(delay).toBeLessThan(expectedMs + 5_000);
    }
  });

  it("gives up after the attempt ceiling", async () => {
    const { logger } = makeLogger();
    await insertBook(db, HIVE_ID);
    await enqueueEnrichment(db, HIVE_ID);
    await db
      .updateTable("enrich_queue")
      .set({ attempts: 3 })
      .where("hiveId", "=", HIVE_ID)
      .execute();

    await drainEnrichmentQueue(db, logger, {
      enrich: fakeEnrich({ enrichment: "failed" }),
    });

    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(0);
  });

  it("skips rows that are claimed or not yet due", async () => {
    const { logger } = makeLogger();
    await enqueueEnrichmentBatch(db, ["bk_future", "bk_claimed"] as HiveId[]);
    await db
      .updateTable("enrich_queue")
      .set({ nextAttemptAt: "2099-01-01T00:00:00.000Z" })
      .where("hiveId", "=", "bk_future")
      .execute();
    await db
      .updateTable("enrich_queue")
      .set({ claimedAt: new Date().toISOString() })
      .where("hiveId", "=", "bk_claimed")
      .execute();

    expect(await drainEnrichmentQueue(db, logger)).toBe(0);
  });

  it("reclaims a stale claim left by a dead process", async () => {
    const { logger } = makeLogger();
    await enqueueEnrichment(db, "bk_ghost" as HiveId);
    await db
      .updateTable("enrich_queue")
      .set({ claimedAt: new Date(Date.now() - 10 * 60_000).toISOString() })
      .where("hiveId", "=", "bk_ghost")
      .execute();

    expect(await drainEnrichmentQueue(db, logger)).toBe(1);
  });
});

describe("convergence", () => {
  /**
   * The queue could not converge before this. A row that hit MAX_ATTEMPTS was
   * deleted without recording anything on hive_book, and `enrichedAt` is only
   * set on success — so the next page view re-enqueued the same book. With a
   * crawler walking all 356k books that was a perpetual-motion machine:
   * 12,444 rows growing ~20/min.
   */
  const alwaysFails = (async (
    _book: unknown,
    ctx: { addWideEventContext: (f: Record<string, unknown>) => void },
  ) => {
    ctx.addWideEventContext({ enrichment: "failed", scrape_failure: "waf_token_rejected" });
  }) as unknown as EnrichFn;

  async function drainUntilExhausted(db: Database, logger: Logger) {
    // 4 attempts, each with a backoff — fast-forward by clearing nextAttemptAt.
    for (let i = 0; i < 6; i++) {
      await drainEnrichmentQueue(db, logger, { enrich: alwaysFails });
      await db
        .updateTable("enrich_queue")
        .set({ nextAttemptAt: new Date(0).toISOString(), claimedAt: null })
        .execute();
    }
  }

  it("stops re-queueing a book that exhausted its attempts", async () => {
    const db = await createTestDb();
    const { logger } = makeLogger();
    await insertBook(db, HIVE_ID);
    await enqueueEnrichment(db, HIVE_ID);

    await drainUntilExhausted(db, logger);

    // Terminal: the queue row is gone AND the book carries the failure.
    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(0);
    const book = await db
      .selectFrom("hive_book")
      .select(["enrichAttempts", "enrichFailedAt"])
      .where("id", "=", HIVE_ID)
      .executeTakeFirstOrThrow();
    expect(book.enrichAttempts).toBeGreaterThanOrEqual(4);
    expect(book.enrichFailedAt).not.toBeNull();

    // The crawler comes back. This is the exact step that used to refill it.
    await enqueueEnrichment(db, HIVE_ID);
    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(0);
  });

  it("reports exhausted books in the heartbeat, not a structurally-zero count", async () => {
    // The gauge used to count `enrich_queue` rows at MAX_ATTEMPTS. Those rows
    // are deleted in the same call that stamps enrichFailedAt, so it could
    // only ever read 0 — the same illusion that hid the requeue loop. It has
    // to be read off hive_book to mean anything.
    const db = await createTestDb();
    const { logger, events } = makeLogger();
    await insertBook(db, HIVE_ID);
    await enqueueEnrichment(db, HIVE_ID);
    await drainUntilExhausted(db, logger);

    await publishEnrichQueueStats(db, logger);

    const heartbeat = events.filter((e) => e["msg"] === "enrich_drainer_heartbeat").at(-1);
    expect(heartbeat).toBeDefined();
    expect(heartbeat!["exhausted"]).toBe(1);
  });

  it("lets a book back in once the cooldown has passed", async () => {
    const db = await createTestDb();
    await insertBook(db, HIVE_ID);
    // Failure is a cooldown, not a tombstone — Goodreads' WAF being up is
    // transient, and those books should become eligible again eventually.
    await db
      .updateTable("hive_book")
      .set({
        enrichAttempts: 4,
        enrichFailedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      })
      .where("id", "=", HIVE_ID)
      .execute();

    await enqueueEnrichment(db, HIVE_ID);
    expect(await db.selectFrom("enrich_queue").selectAll().execute()).toHaveLength(1);
  });

  it("filters only the cooling books out of a mixed batch", async () => {
    const db = await createTestDb();
    const cooled = "bk_cooled" as HiveId;
    const fresh = "bk_fresh" as HiveId;
    await insertBook(db, cooled);
    await insertBook(db, fresh);
    await db
      .updateTable("hive_book")
      .set({ enrichAttempts: 4, enrichFailedAt: new Date().toISOString() })
      .where("id", "=", cooled)
      .execute();

    await enqueueEnrichmentBatch(db, [cooled, fresh]);
    const rows = await db.selectFrom("enrich_queue").select("hiveId").execute();
    expect(rows.map((r) => r.hiveId)).toEqual([fresh]);
  });
});
