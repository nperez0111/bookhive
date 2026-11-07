import { describe, it, expect, spyOn } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sqliteKv, {
  createSharedKvDb,
  initializePageCache,
  sweepPageCache,
  vacuumKvIfBloated,
} from "./sqlite-kv";

const noop = () => {};
const pragma = (db: DatabaseSync, name: string) =>
  Object.values((db.query(`PRAGMA ${name}`).get() ?? {}) as Record<string, number>)[0] ?? 0;

describe("page cache maintenance", () => {
  it("initializes independent in-memory page connections before mounting a pre-created driver", async () => {
    const primary = createSharedKvDb(":memory:");
    const page = createSharedKvDb(":memory:", 50);
    try {
      initializePageCache(primary.sqlite);
      expect(
        page.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'page_cache'").get(),
      ).toBeNull();
      initializePageCache(page.sqlite);
      const driver = sqliteKv({ table: "page_cache", db: page.db, tableCreated: true });
      await driver.setItem!("test", "cached", {});
      expect(await driver.getItem!("test", {})).toBe("cached");
    } finally {
      await page.db.destroy();
      await primary.db.destroy();
    }
  });

  it("stops at the batch budget and leaves remaining expired rows for the next sweep", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializePageCache(db);
      const insert = db.prepare("INSERT INTO page_cache VALUES (?, 'value', '', '2026-01-01')");
      db.transaction(() => {
        for (let n = 0; n < 10_100; n++) insert.run(String(n));
      })();
      const logs: Record<string, unknown>[] = [];
      await sweepPageCache(db, "2026-01-15", (fields) => logs.push(fields));
      expect(logs[0]).toMatchObject({ batches: 100, deleted_rows: 10_000, budget_exhausted: true });
      expect(db.query("SELECT count(*) AS count FROM page_cache").get()).toEqual({ count: 100 });
    } finally {
      db.close();
    }
  });

  it("stops at the time budget without deleting the remaining expired rows", async () => {
    const db = new DatabaseSync(":memory:");
    initializePageCache(db);
    const insert = db.prepare("INSERT INTO page_cache VALUES (?, 'value', '', '2026-01-01')");
    for (let n = 0; n < 200; n++) insert.run(String(n));
    const clock = spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(5000);
    try {
      const logs: Record<string, unknown>[] = [];
      await sweepPageCache(db, "2026-01-15", (fields) => logs.push(fields));
      expect(logs[0]).toMatchObject({ batches: 1, deleted_rows: 100, budget_exhausted: true });
      expect(db.query("SELECT count(*) AS count FROM page_cache").get()).toEqual({ count: 100 });
    } finally {
      clock.mockRestore();
      db.close();
    }
  });

  it("indexes expiry on existing tables and deletes only expired rows in multiple batches", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE page_cache (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    initializePageCache(db);
    initializePageCache(db);
    const insert = db.prepare("INSERT INTO page_cache VALUES (?, 'value', '', ?)");
    for (let n = 0; n < 250; n++) insert.run(`old${n}`, "2026-01-01");
    insert.run("fresh", "2026-02-01");
    const plan = JSON.stringify(
      db
        .query(
          "EXPLAIN QUERY PLAN SELECT id FROM page_cache WHERE updated_at < ? ORDER BY updated_at LIMIT 100",
        )
        .all("2026-01-15"),
    );
    expect(plan).toContain("idx_page_cache_updated_at");
    expect(plan).not.toContain("SCAN page_cache");
    const logs: Record<string, unknown>[] = [];
    await sweepPageCache(db, "2026-01-15", (fields) => logs.push(fields));
    expect(db.query("SELECT id FROM page_cache").all()).toEqual([{ id: "fresh" }]);
    expect(logs[0]).toMatchObject({
      outcome: "success",
      deleted_rows: 250,
      batches: 3,
      budget_exhausted: false,
    });
    expect(typeof logs[0]?.["vacuum_ms"]).toBe("number");
    db.close();
  });

  it("uses a short lock wait for optional page writes without changing the durable KV default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bookhive-kv-contention-"));
    const location = join(dir, "kv.sqlite");
    const durable = createSharedKvDb(location);
    initializePageCache(durable.sqlite);
    const page = createSharedKvDb(location, 50);
    const driver = sqliteKv({ table: "page_cache", db: page.db, tableCreated: true });
    try {
      await driver.hasItem!("initialize", {});
      expect(pragma(durable.sqlite, "busy_timeout")).toBe(10000);
      expect(pragma(page.sqlite, "busy_timeout")).toBe(50);
      durable.sqlite.exec("BEGIN IMMEDIATE");
      const started = performance.now();
      const error = await Promise.resolve(driver.setItem!("key", "value", {})).catch(
        (err: unknown) => err,
      );
      expect(String(error)).toContain("database is locked");
      expect(performance.now() - started).toBeLessThan(1000);
      const logs: Record<string, unknown>[] = [];
      await sweepPageCache(page.sqlite, "2026-01-15", (fields) => logs.push(fields));
      expect(logs[0]).toMatchObject({ outcome: "error", phase: "delete" });
      expect(typeof logs[0]?.["failed_phase_ms"]).toBe("number");
    } finally {
      durable.sqlite.exec("ROLLBACK");
      await page.db.destroy();
      await durable.db.destroy();
      rmSync(dir, { recursive: true });
    }
  });
});

/** Fill then delete, which is what leaves free pages behind. */
function makeBloated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE kv (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO kv (id, value) VALUES (?1, ?2)");
  for (let i = 0; i < 3_000; i++) insert.run(`k${i}`, "x".repeat(2_000));
  db.exec("DELETE FROM kv WHERE id != 'k0'");
  return db;
}

describe("vacuumKvIfBloated", () => {
  it("reclaims free pages and switches the file to incremental auto-vacuum", () => {
    const db = makeBloated();
    const before = pragma(db, "page_count");
    expect(pragma(db, "freelist_count") / before).toBeGreaterThan(0.25);

    const logs: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    vacuumKvIfBloated(db, (fields, msg) => logs.push({ fields, msg }));

    expect(pragma(db, "page_count")).toBeLessThan(before);
    expect(pragma(db, "freelist_count")).toBe(0);
    // 2 = INCREMENTAL. Without this the file goes straight back to growing.
    expect(pragma(db, "auto_vacuum")).toBe(2);
    expect(logs[0]?.msg).toBe("kv VACUUM complete");
    expect(logs[0]?.fields["before_bytes"]).toBeGreaterThan(
      logs[0]?.fields["after_bytes"] as number,
    );
  });

  it("skips a healthy file that is already incremental", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    db.exec("VACUUM");
    db.exec("CREATE TABLE kv (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("INSERT INTO kv VALUES ('a', 'b')");

    const logs: string[] = [];
    vacuumKvIfBloated(db, (_f, msg) => logs.push(msg));
    // No rewrite: a deploy on a clean file should cost nothing.
    expect(logs).toEqual([]);
  });

  it("still converts a healthy file that was never set to incremental", () => {
    // The one-time migration case — low bloat, but auto_vacuum is still NONE,
    // so it has to run once or the file starts growing again immediately.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE kv (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("INSERT INTO kv VALUES ('a', 'b')");
    expect(pragma(db, "auto_vacuum")).toBe(0);

    vacuumKvIfBloated(db, noop);
    expect(pragma(db, "auto_vacuum")).toBe(2);
  });

  it("does not throw on an empty database", () => {
    expect(() => vacuumKvIfBloated(new DatabaseSync(":memory:"), noop)).not.toThrow();
  });

  it("swallows a VACUUM failure and reports it, rather than failing startup", () => {
    const db = makeBloated();
    const realExec = db.exec.bind(db);
    // A VACUUM can genuinely fail at runtime — no disk space for the rewrite,
    // or another connection holding an open transaction on the file.
    db.exec = ((sql: string) => {
      if (sql.includes("VACUUM")) throw new Error("database or disk is full");
      return realExec(sql);
    }) as typeof db.exec;

    const logs: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    expect(() => vacuumKvIfBloated(db, (fields, msg) => logs.push({ fields, msg }))).not.toThrow();
    expect(logs.some((l) => l.msg === "kv VACUUM failed")).toBe(true);
  });
});

describe("page cache incremental vacuum", () => {
  it("reclaims pages freed since the last run", async () => {
    const db = makeBloated();
    vacuumKvIfBloated(db, noop);
    initializePageCache(db);

    const insert = db.prepare("INSERT INTO kv (id, value) VALUES (?1, ?2)");
    for (let i = 0; i < 2_000; i++) insert.run(`n${i}`, "y".repeat(2_000));
    db.exec("DELETE FROM kv");
    const bloated = pragma(db, "page_count");
    expect(pragma(db, "freelist_count")).toBeGreaterThan(0);

    await sweepPageCache(db, "2026-01-15", noop);
    expect(pragma(db, "page_count")).toBeLessThan(bloated);
    db.close();
  });

  it("is a no-op — not an error — when auto_vacuum was never enabled", async () => {
    const db = new DatabaseSync(":memory:");
    initializePageCache(db);
    const logs: Record<string, unknown>[] = [];
    await sweepPageCache(db, "2026-01-15", (fields) => logs.push(fields));
    expect(pragma(db, "auto_vacuum")).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ outcome: "success", deleted_rows: 0, batches: 1 });
    db.close();
  });

  it("reports a vacuum failure once with deletion counts and failure-phase timing", async () => {
    const db = new DatabaseSync(":memory:");
    initializePageCache(db);
    db.exec("INSERT INTO page_cache VALUES ('expired', 'value', '', '2026-01-01')");
    const exec = db.exec.bind(db);
    db.exec = ((sql: string) => {
      if (sql.includes("incremental_vacuum")) throw new Error("disk failure");
      return exec(sql);
    }) as typeof db.exec;
    const logs: Record<string, unknown>[] = [];
    await sweepPageCache(db, "2026-01-15", (fields) => logs.push(fields));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      outcome: "error",
      phase: "vacuum",
      deleted_rows: 1,
      batches: 1,
      budget_exhausted: false,
    });
    expect(logs[0]?.["err"]).toBeInstanceOf(Error);
    for (const field of ["delete_ms", "vacuum_ms", "duration_ms", "failed_phase_ms"]) {
      expect(logs[0]?.[field]).toBeNumber();
    }
    expect(db.query("SELECT * FROM page_cache").all()).toEqual([]);
    db.close();
  });
});
