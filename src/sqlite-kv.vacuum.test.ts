import { describe, it, expect } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";

import { incrementalVacuumKv, vacuumKvIfBloated } from "./sqlite-kv";

const noop = () => {};
const pragma = (db: DatabaseSync, name: string) =>
  Object.values((db.query(`PRAGMA ${name}`).get() ?? {}) as Record<string, number>)[0] ?? 0;

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
});

describe("incrementalVacuumKv", () => {
  it("reclaims pages freed since the last run", () => {
    const db = makeBloated();
    vacuumKvIfBloated(db, noop);

    const insert = db.prepare("INSERT INTO kv (id, value) VALUES (?1, ?2)");
    for (let i = 0; i < 2_000; i++) insert.run(`n${i}`, "y".repeat(2_000));
    db.exec("DELETE FROM kv");
    const bloated = pragma(db, "page_count");
    expect(pragma(db, "freelist_count")).toBeGreaterThan(0);

    incrementalVacuumKv(db);
    expect(pragma(db, "page_count")).toBeLessThan(bloated);
  });

  it("is a no-op — not an error — when auto_vacuum was never enabled", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE kv (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    expect(() => incrementalVacuumKv(db)).not.toThrow();
  });
});
