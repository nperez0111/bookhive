import { describe, it, expect, beforeEach, afterEach, jest } from "bun:test";
import { sql } from "kysely";
import { createSharedKvDb, type KvDb } from "../sqlite-kv";
import { createCrossProcessLock } from "./refresh-lock";

let db: KvDb;
const realSetImmediate = setImmediate;
const nextTurn = () => new Promise<void>((resolve) => realSetImmediate(resolve));

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await nextTurn();
}

beforeEach(() => {
  db = createSharedKvDb(":memory:").db;
});

afterEach(async () => {
  jest.useRealTimers();
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
    expect(
      lock("test-key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await sql`SELECT * FROM auth_refresh_lock WHERE id = 'test-key'`.execute(db);
    expect(rows.rows).toHaveLength(0);
  });

  it("allows re-entrant calls within the same process", async () => {
    // All calls in one process share the OWNER, so the lock is re-entrant by design — only different workers need to block each other.
    const lock = createCrossProcessLock(db);
    const results: string[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const p1 = lock("same-key", async () => {
      results.push("p1-start");
      started.resolve();
      await release.promise;
      results.push("p1-end");
      return "first";
    });

    await started.promise;

    const p2 = lock("same-key", async () => {
      results.push("p2");
      return "second";
    });

    expect(await p2).toBe("second");
    expect(results).toEqual(["p1-start", "p2"]);
    release.resolve();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(results).toContain("p1-start");
    expect(results).toContain("p1-end");
    expect(results).toContain("p2");
  });

  it("allows concurrent callbacks for different keys", async () => {
    const lock = createCrossProcessLock(db);
    const order: string[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const p1 = lock("key-a", async () => {
      order.push("a-start");
      started.resolve();
      await release.promise;
      order.push("a-end");
    });

    await started.promise;

    const p2 = lock("key-b", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await p2;
    expect(order).toEqual(["a-start", "b-start", "b-end"]);
    release.resolve();
    await p1;
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });

  it("cleans up stale locks from other owners", async () => {
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
    jest.useFakeTimers();
    // Simulate another process holding a fresh lock.
    const lock = createCrossProcessLock(db);
    const freshTime = Date.now();
    await sql`INSERT INTO auth_refresh_lock (id, owner, acquired_at) VALUES ('held-key', 'other-pid-999', ${freshTime})`.execute(
      db,
    );

    let acquired = false;
    const pending = lock("held-key", async () => {
      acquired = true;
      return "acquired";
    });
    await nextTurn();
    await advance(25);
    await advance(50);
    expect(acquired).toBe(false);
    await sql`DELETE FROM auth_refresh_lock WHERE id = 'held-key'`.execute(db);
    await advance(100);
    expect(await pending).toBe("acquired");
    expect(acquired).toBe(true);
  });

  // Regression: a holder wedged on an unreachable PDS kept its lock alive via the heartbeat, so waiters spun forever issuing blocking SQLite statements.
  it("gives up on a permanently held lock within its wait budget", async () => {
    jest.useFakeTimers();
    // A short wait budget stands in for MAX_WAIT_MS — the invariant is giving up rather than spinning forever, not the exact budget.
    const maxWaitMs = 120;
    const lock = createCrossProcessLock(db, { maxWaitMs });
    await sql`INSERT INTO auth_refresh_lock (id, owner, acquired_at) VALUES ('wedged', 'other-pid-999', ${Date.now()})`.execute(
      db,
    );

    // Awaited explicitly rather than through `expect().rejects`: the assertion
    // below measures how long the waiter blocked, and bun's `.rejects` returns
    // `undefined` (it drains the loop internally) so nothing in the expression
    // makes that dependency visible.
    const start = Date.now();
    const pending = lock("wedged", async () => "never").catch((e: unknown) => e);
    await nextTurn();
    await advance(25);
    await advance(50);
    await advance(45);
    const error = await pending;
    const elapsed = Date.now() - start;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Cross-process lock timeout for wedged");

    expect(elapsed).toBeGreaterThanOrEqual(maxWaitMs);
    expect(elapsed).toBeLessThan(maxWaitMs + 3_000);
    // The other owner's lock must survive — we only ever delete our own.
    const rows = await sql`SELECT * FROM auth_refresh_lock WHERE id = 'wedged'`.execute(db);
    expect(rows.rows).toHaveLength(1);
  });

  it("backs off exponentially rather than polling at a fixed interval", async () => {
    jest.useFakeTimers();
    const lock = createCrossProcessLock(db, { maxWaitMs: 120 });
    await sql`INSERT INTO auth_refresh_lock (id, owner, acquired_at) VALUES ('counted', 'other-pid-999', ${Date.now()})`.execute(
      db,
    );

    let selects = 0;
    const originalExecuteQuery = db.executeQuery.bind(db);
    db.executeQuery = ((compiled: { sql: string }) => {
      if (compiled.sql.trimStart().toUpperCase().startsWith("SELECT")) selects++;
      return originalExecuteQuery(compiled as never);
    }) as typeof db.executeQuery;

    let error: unknown;
    try {
      // Awaited directly, not via `expect().rejects`: the `finally` must not
      // restore `executeQuery` until the waiter has finished polling, or
      // `selects` counts nothing.
      const pending = lock("counted", async () => "never").catch((e: unknown) => e);
      await nextTurn();
      await advance(25);
      await advance(50);
      await advance(45);
      error = await pending;
    } finally {
      db.executeQuery = originalExecuteQuery;
    }
    expect((error as Error).message).toContain("Cross-process lock");

    // Backoff must keep the attempt count to a handful, not scale linearly with the wait budget.
    expect(selects).toBeLessThan(15);
  });
});
