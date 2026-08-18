import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect, sql, type Generated } from "kysely";

import { toImmediateTransaction, wrapBunSqliteForKysely } from "./bun-sqlite-kysely";

type Row = { id: Generated<number>; name: string; note: string | null };
type Schema = { thing: Row };

function createDb(): Kysely<Schema> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE thing (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT)",
  );
  return new Kysely<Schema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
}

describe("wrapBunSqliteForKysely", () => {
  let db: Kysely<Schema>;

  beforeEach(() => {
    db = createDb();
  });

  // Kysely picks all() vs run() from `statement.reader`. Classifying
  // "INSERT ... RETURNING" as a non-reader makes it execute but yield no rows,
  // which surfaces as a 500 far away from the cause.
  it("returns rows from INSERT ... RETURNING", async () => {
    const row = await db
      .insertInto("thing")
      .values({ name: "a", note: null })
      .returning(["id", "name", "note"])
      .executeTakeFirstOrThrow();

    expect(row.name).toBe("a");
    expect(row.id).toBeGreaterThan(0);
  });

  it("returns rows from UPDATE ... RETURNING", async () => {
    await db.insertInto("thing").values({ name: "a", note: null }).execute();

    const row = await db
      .updateTable("thing")
      .set({ name: "b" })
      .where("name", "=", "a")
      .returning(["id", "name"])
      .executeTakeFirstOrThrow();

    expect(row.name).toBe("b");
  });

  it("returns rows from DELETE ... RETURNING", async () => {
    await db.insertInto("thing").values({ name: "a", note: null }).execute();

    const rows = await db.deleteFrom("thing").where("name", "=", "a").returning(["name"]).execute();

    expect(rows.map((r) => r.name)).toEqual(["a"]);
  });

  it("still reports affected rows for writes without RETURNING", async () => {
    await db.insertInto("thing").values({ name: "a", note: null }).execute();

    // /library/sync/dismiss and /sync/rename branch on numUpdatedRows, so
    // misclassifying a plain UPDATE as a reader would silently 404 them.
    const res = await db
      .updateTable("thing")
      .set({ name: "b" })
      .where("name", "=", "a")
      .executeTakeFirst();
    expect(Number(res.numUpdatedRows)).toBe(1);

    const noMatch = await db
      .updateTable("thing")
      .set({ name: "c" })
      .where("name", "=", "nope")
      .executeTakeFirst();
    expect(Number(noMatch.numUpdatedRows)).toBe(0);
  });

  it("still reads plain SELECTs", async () => {
    await db.insertInto("thing").values({ name: "a", note: "n" }).execute();
    const rows = await db.selectFrom("thing").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.note).toBe("n");
  });

  it("returns rows from a query fronted by a CTE", async () => {
    // `WITH ... SELECT` used to be classified as a non-reader (the check was
    // anchored on a leading SELECT), so Kysely called run() and the query
    // yielded zero rows with no error whatsoever. The author-directory cover
    // lookup is a window function over a CTE, and it silently returned nothing.
    await db.insertInto("thing").values({ name: "a", note: "n" }).execute();

    const rows = await sql<{ name: string }>`
      WITH ranked AS (
        SELECT name, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM thing
      )
      SELECT name FROM ranked WHERE rn = 1
    `.execute(db);

    expect(rows.rows.map((r) => r.name)).toEqual(["a"]);
  });

  it("still reports affected rows for a write fronted by a CTE", async () => {
    // The converse: a leading CTE does not make a statement a reader.
    await db.insertInto("thing").values({ name: "a", note: null }).execute();

    const res = await sql`
      WITH targets AS (SELECT id FROM thing WHERE name = 'a')
      UPDATE thing SET name = 'b' WHERE id IN (SELECT id FROM targets)
    `.execute(db);

    expect(Number(res.numAffectedRows)).toBe(1);
  });

  it("runs transactions", async () => {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto("thing").values({ name: "in-txn", note: null }).execute();
    });
    const rows = await db.selectFrom("thing").selectAll().execute();
    expect(rows.map((r) => r.name)).toEqual(["in-txn"]);
  });
});

// A deferred BEGIN that later upgrades to a write fails with
// SQLITE_BUSY_SNAPSHOT, which the busy handler is never consulted about — so
// PRAGMA busy_timeout cannot rescue it. Taking the write lock up front means the
// timeout applies.
describe("toImmediateTransaction", () => {
  it("upgrades Kysely's bare begin", () => {
    expect(toImmediateTransaction("begin")).toBe("begin immediate");
    expect(toImmediateTransaction("BEGIN")).toBe("begin immediate");
    expect(toImmediateTransaction(" begin ")).toBe("begin immediate");
    expect(toImmediateTransaction("begin;")).toBe("begin immediate");
  });

  it("leaves everything else alone", () => {
    expect(toImmediateTransaction("commit")).toBe("commit");
    expect(toImmediateTransaction("rollback")).toBe("rollback");
    expect(toImmediateTransaction("begin deferred")).toBe("begin deferred");
    expect(toImmediateTransaction("select * from beginnings")).toBe("select * from beginnings");
    expect(toImmediateTransaction("savepoint s1")).toBe("savepoint s1");
  });
});
