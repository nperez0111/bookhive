import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "kysely";
import { createSharedKvDb, type KvDb } from "../sqlite-kv";
import { createCrossProcessLock } from "./refresh-lock";

let db: KvDb;

beforeEach(() => {
  db = createSharedKvDb(":memory:");
});

afterEach(async () => {
  await db.destroy();
});

describe("createCrossProcessLock", () => {
  it("runs the callback and returns its result", async () => {
    const lock = createCrossProcessLock(db);
    const result = await lock("test-key", async () => 42);
    expect(result).toBe(42);
  });

  it("releases the lock after the callback completes", async () => {
    const lock = createCrossProcessLock(db);
    await lock("test-key", async () => "done");

    const rows = await sql`SELECT * FROM auth_refresh_lock WHERE id = 'test-key'`.execute(db);
    expect(rows.rows).toHaveLength(0);
  });

  it("releases the lock when the callback throws", async () => {
    const lock = createCrossProcessLock(db);
    await expect(
      lock("test-key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await sql`SELECT * FROM auth_refresh_lock WHERE id = 'test-key'`.execute(db);
    expect(rows.rows).toHaveLength(0);
  });

  it("allows re-entrant calls within the same process", async () => {
    // Within a single process, all calls share the same OWNER, so the lock
    // is re-entrant. This is by design — @atcute's CachedGetter#pending
    // handles in-process serialization; the cross-process lock only needs
    // to block different workers (different OWNER values).
    const lock = createCrossProcessLock(db);
    const results: string[] = [];

    const p1 = lock("same-key", async () => {
      results.push("p1-start");
      await new Promise((r) => setTimeout(r, 50));
      results.push("p1-end");
      return "first";
    });

    await new Promise((r) => setTimeout(r, 10));

    const p2 = lock("same-key", async () => {
      results.push("p2");
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    // Both should complete (re-entrant within same process)
    expect(results).toContain("p1-start");
    expect(results).toContain("p1-end");
    expect(results).toContain("p2");
  });

  it("allows concurrent callbacks for different keys", async () => {
    const lock = createCrossProcessLock(db);
    const order: string[] = [];

    const p1 = lock("key-a", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("a-end");
    });

    await new Promise((r) => setTimeout(r, 5));

    const p2 = lock("key-b", async () => {
      order.push("b-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("b-end");
    });

    await Promise.all([p1, p2]);
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });

  it("cleans up stale locks from other owners", async () => {
    // Create the table first by initializing the lock.
    const lock = createCrossProcessLock(db);

    // Simulate a stale lock from a crashed process.
    const staleCutoff = Date.now() - 60_000;
    await sql`INSERT OR REPLACE INTO auth_refresh_lock (id, owner, acquired_at) VALUES ('stale-key', 'dead-pid-123', ${staleCutoff})`.execute(
      db,
    );

    const result = await lock("stale-key", async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("blocks a different owner from acquiring the same key", async () => {
    // Simulate another process holding a fresh lock.
    const lock = createCrossProcessLock(db);
    const freshTime = Date.now();
    await sql`INSERT INTO auth_refresh_lock (id, owner, acquired_at) VALUES ('held-key', 'other-pid-999', ${freshTime})`.execute(
      db,
    );

    // Our lock attempt should block until the other owner releases.
    // We release it after a short delay to avoid a real timeout.
    const releaseTimer = setTimeout(async () => {
      await sql`DELETE FROM auth_refresh_lock WHERE id = 'held-key'`.execute(db);
    }, 300);

    const start = Date.now();
    const result = await lock("held-key", async () => "acquired");
    const elapsed = Date.now() - start;

    clearTimeout(releaseTimer);
    expect(result).toBe("acquired");
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});
