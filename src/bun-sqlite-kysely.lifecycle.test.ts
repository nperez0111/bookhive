import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Kysely, SqliteDialect, sql } from "kysely";
import { rejects } from "node:assert/strict";

import { wrapBunSqliteForKysely, type KyselySqliteDatabase } from "./bun-sqlite-kysely";

// These runtime 1.4.4 APIs are newer than the installed Bun type declarations.
type NativeStatement = ReturnType<Database["prepare"]> & { readonly isFinalized: boolean };
type NativeDatabase = Database & {
  function(name: string, callback: (...args: number[]) => unknown): void;
};
type Schema = { thing: { id: number; name: string; data: Uint8Array } };

describe("Bun SQLite statement ownership", () => {
  let raw: NativeDatabase;
  let adapter: KyselySqliteDatabase;
  let db: Kysely<Schema>;
  // Intentional strong references are ONLY an ownership assertion aid. These
  // tests do not measure GC behavior, retained bytes, or performance.
  let statements: NativeStatement[];
  let preparedSql: string[];

  const openStatements = () => statements.filter((stmt) => !stmt.isFinalized);

  beforeEach(() => {
    raw = new Database(":memory:", { strict: true }) as NativeDatabase;
    raw.exec(
      "CREATE TABLE thing(id INTEGER PRIMARY KEY, name TEXT NOT NULL, data BLOB);" +
        "INSERT INTO thing VALUES (1,'one',x'010203'),(2,'two',x'040506')",
    );
    statements = [];
    preparedSql = [];
    const prepare = raw.prepare.bind(raw);
    raw.prepare = ((text: string) => {
      const stmt = prepare(text) as NativeStatement;
      statements.push(stmt);
      preparedSql.push(text);
      return stmt;
    }) as typeof raw.prepare;
    adapter = wrapBunSqliteForKysely(raw);
    db = new Kysely<Schema>({ dialect: new SqliteDialect({ database: adapter }) });
  });

  afterEach(async () => {
    for (const stmt of openStatements()) stmt.finalize();
    await db.destroy();
    raw.close();
  });

  it("defers preparation until metadata or execution, including never-started iterators", () => {
    const stmt = adapter.prepare("SELECT * FROM thing");
    expect(statements).toHaveLength(0);
    const iterator = stmt.iterate([]);
    expect(statements).toHaveLength(0);
    iterator.return?.();
    expect(statements).toHaveLength(0);
    expect(stmt.all([])).toHaveLength(2);
    expect(statements).toHaveLength(1);
    expect(openStatements()).toHaveLength(0);
  });

  it("consumes the metadata statement once and keeps the wrapper reusable", () => {
    const stmt = adapter.prepare("SELECT name FROM thing WHERE id=?");
    expect(stmt.reader).toBe(true);
    expect(stmt.reader).toBe(true);
    expect(statements).toHaveLength(1);
    expect(openStatements()).toHaveLength(1);
    expect(stmt.all([1])).toEqual([{ name: "one" }]);
    expect(openStatements()).toHaveLength(0);
    expect(stmt.reader).toBe(true);
    expect(statements).toHaveLength(1);
    expect(stmt.all([2])).toEqual([{ name: "two" }]);
    expect(statements).toHaveLength(2);
    expect(openStatements()).toHaveLength(0);
  });

  it("reuses write wrappers with affected-row and insertion-id results", () => {
    const insert = adapter.prepare("INSERT INTO thing(id,name) VALUES (?,?)");
    expect(insert.reader).toBe(false);
    expect(insert.run([3, "three"])).toEqual({ changes: 1, lastInsertRowid: 3 });
    expect(insert.run([4, "four"])).toEqual({ changes: 1, lastInsertRowid: 4 });
    expect(openStatements()).toHaveLength(0);
    const update = adapter.prepare("UPDATE thing SET name=? WHERE id=?");
    expect(update.run(["edited", 1]).changes).toBe(1);
    expect(update.run(["missing", 99]).changes).toBe(0);
    expect(update.reader).toBe(false);
    // Reading metadata without executing leaves one GC-owned pending statement.
    expect(openStatements()).toHaveLength(1);
    update.run(["edited", 2]);
    expect(openStatements()).toHaveLength(0);
  });

  it("does not carry native bindings from a previous invocation", () => {
    const stmt = adapter.prepare("SELECT ? AS value");
    expect(stmt.all([7])).toEqual([{ value: 7 }]);
    expect(stmt.all([])).toEqual([{ value: null }]);
    expect(stmt.all([9])).toEqual([{ value: 9 }]);
    expect(openStatements()).toHaveLength(0);
  });

  it("uses native reader metadata without constructing column-name arrays", () => {
    const prepare = raw.prepare.bind(raw);
    raw.prepare = ((text: string) => {
      const stmt = prepare(text);
      Object.defineProperty(stmt, "columnNames", {
        get() {
          throw new Error("column names should not be read on pinned Bun");
        },
      });
      return stmt;
    }) as typeof raw.prepare;
    const stmt = adapter.prepare("WITH c AS (SELECT 1 AS n) SELECT n FROM c");
    expect(stmt.reader).toBe(true);
    expect(stmt.all([])).toEqual([{ n: 1 }]);
    expect(openStatements()).toHaveLength(0);
  });

  it("falls back to one SQLite column-name read when native reader is unavailable", () => {
    const prepare = raw.prepare.bind(raw);
    let reads = 0;
    raw.prepare = ((text: string) => {
      const stmt = prepare(text);
      Object.defineProperty(stmt, "reader", { value: undefined });
      Object.defineProperty(stmt, "columnNames", {
        get() {
          reads++;
          return ["n"];
        },
      });
      return stmt;
    }) as typeof raw.prepare;
    const stmt = adapter.prepare("WITH c AS (SELECT 1 AS n) SELECT n FROM c");
    expect(stmt.reader).toBe(true);
    expect(reads).toBe(1);
    expect(stmt.all([])).toEqual([{ n: 1 }]);
    expect(openStatements()).toHaveLength(0);
  });

  it("finalizes failed metadata and permits a later reader attempt", () => {
    const prepare = raw.prepare.bind(raw);
    const failure = new Error("metadata failed");
    let first = true;
    raw.prepare = ((text: string) => {
      const stmt = prepare(text);
      if (first) {
        first = false;
        Object.defineProperty(stmt, "reader", {
          get() {
            throw failure;
          },
        });
      }
      return stmt;
    }) as typeof raw.prepare;
    const stmt = adapter.prepare("SELECT name FROM thing");
    expect(() => stmt.reader).toThrow(failure);
    expect(openStatements()).toHaveLength(0);
    expect(stmt.reader).toBe(true);
    expect(stmt.all([])).toHaveLength(2);
    expect(openStatements()).toHaveLength(0);
  });

  it("leaves materialized text and blobs valid after finalization and later writes", () => {
    const rows = adapter.prepare("SELECT name,data FROM thing WHERE id=1").all([]);
    expect(openStatements()).toHaveLength(0);
    adapter.prepare("UPDATE thing SET name='changed',data=x'ff' WHERE id=1").run([]);
    expect(rows).toEqual([{ name: "one", data: new Uint8Array([1, 2, 3]) }]);
    expect(openStatements()).toHaveLength(0);
  });

  it("finalizes SQL, binding, constraint and RETURNING failures", () => {
    const invalid = adapter.prepare("not valid SQL");
    expect(statements).toHaveLength(0);
    expect(() => invalid.reader).toThrow(/syntax/);
    expect(() => invalid.all([])).toThrow(/syntax/);
    const update = adapter.prepare("UPDATE thing SET name=? WHERE id=?");
    expect(() => update.run([{}, 1])).toThrow();
    expect(openStatements()).toHaveLength(0);
    expect(() =>
      adapter.prepare("INSERT INTO thing(id,name) VALUES (?,?)").run([1, "dup"]),
    ).toThrow(/UNIQUE/);
    expect(openStatements()).toHaveLength(0);
    const returning = adapter.prepare("INSERT INTO thing(id,name) VALUES (?,?) RETURNING id");
    expect(returning.reader).toBe(true);
    expect(() => returning.all([1, "dup"])).toThrow(/UNIQUE/);
    expect(openStatements()).toHaveLength(0);
    expect(() => returning.all([3, {}])).toThrow();
    expect(openStatements()).toHaveLength(0);
    expect(returning.all([3, "three"])).toEqual([{ id: 3 }]);
    expect(openStatements()).toHaveLength(0);
  });

  it("preserves primary metadata/execution/iteration failures if cleanup also fails", () => {
    const prepare = raw.prepare.bind(raw);
    const cleanupFailure = new Error("cleanup failed");
    const metadataFailure = new Error("metadata failed");
    raw.prepare = ((text: string) => {
      const stmt = prepare(text);
      const finalize = stmt.finalize.bind(stmt);
      stmt.finalize = () => {
        finalize();
        throw cleanupFailure;
      };
      if (text === "SELECT 123") {
        Object.defineProperty(stmt, "reader", {
          get() {
            throw metadataFailure;
          },
        });
      }
      return stmt;
    }) as typeof raw.prepare;
    expect(() => adapter.prepare("SELECT 123").reader).toThrow(metadataFailure);
    expect(() => adapter.prepare("INSERT INTO thing(id,name) VALUES (1,'dup')").run([])).toThrow(
      /UNIQUE/,
    );
    expect(() =>
      adapter.prepare("INSERT INTO thing(id,name) VALUES (1,'dup') RETURNING id").all([]),
    ).toThrow(/UNIQUE/);
    raw.function("fail", () => {
      throw new Error("row callback failed");
    });
    expect(() => adapter.prepare("SELECT fail()").iterate([]).next()).toThrow(
      /row callback failed/,
    );
    expect(openStatements()).toHaveLength(0);
    // Cleanup failures after successful execution must remain observable.
    expect(() => adapter.prepare("SELECT 1").all([])).toThrow(cleanupFailure);
    expect(() => adapter.prepare("UPDATE thing SET name='ok' WHERE id=1").run([])).toThrow(
      cleanupFailure,
    );
    expect(() => [...adapter.prepare("SELECT 1").iterate([])]).toThrow(cleanupFailure);
    expect(openStatements()).toHaveLength(0);
  });

  it("executes the same compiled Kysely query with one finalized preparation each time", async () => {
    const query = db.selectFrom("thing").select("name").where("id", "=", 1).compile();
    expect((await db.executeQuery(query)).rows).toEqual([{ name: "one" }]);
    expect((await db.executeQuery(query)).rows).toEqual([{ name: "one" }]);
    expect(statements).toHaveLength(2);
    expect(openStatements()).toHaveLength(0);
  });

  it("preserves the exact primary exception object through secondary cleanup failures", () => {
    const prepare = raw.prepare.bind(raw);
    const primary = new Error("primary failure");
    raw.prepare = ((text: string) => {
      const stmt = prepare(text);
      const finalize = stmt.finalize.bind(stmt);
      stmt.all = () => {
        throw primary;
      };
      stmt.run = () => {
        throw primary;
      };
      stmt.iterate = () => ({
        next() {
          throw primary;
        },
        [Symbol.iterator]() {
          return this;
        },
      });
      stmt.finalize = () => {
        finalize();
        throw new Error("secondary cleanup failure");
      };
      return stmt;
    }) as typeof raw.prepare;
    const calls = [
      () => adapter.prepare("SELECT 1").all([]),
      () => adapter.prepare("UPDATE thing SET name='n'").run([]),
      () => adapter.prepare("SELECT 1").iterate([]).next(),
    ];
    for (const call of calls) {
      let caught: unknown;
      try {
        call();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(primary);
      expect(openStatements()).toHaveLength(0);
    }
  });

  it("finalizes full, returned and broken direct iterators", () => {
    const stmt = adapter.prepare("SELECT id FROM thing ORDER BY id");
    expect([...stmt.iterate([])]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(openStatements()).toHaveLength(0);
    const iterator = stmt.iterate([]);
    expect(iterator.next().value).toEqual({ id: 1 });
    expect(openStatements()).toHaveLength(1);
    iterator.return?.();
    expect(openStatements()).toHaveLength(0);
    for (const row of stmt.iterate([])) {
      expect(row).toEqual({ id: 1 });
      break;
    }
    expect(openStatements()).toHaveLength(0);
  });

  it("gives interleaved invocations independent cursors and local cleanup ownership", () => {
    const stmt = adapter.prepare("SELECT id FROM thing ORDER BY id");
    expect(stmt.reader).toBe(true);
    const first = stmt.iterate([]);
    const second = stmt.iterate([]);
    expect(first.next().value).toEqual({ id: 1 });
    expect(second.next().value).toEqual({ id: 1 });
    expect(openStatements()).toHaveLength(2);
    expect(stmt.all([])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(openStatements()).toHaveLength(2);
    first.return?.();
    expect(openStatements()).toHaveLength(1);
    expect(second.next().value).toEqual({ id: 2 });
    expect(second.next().done).toBe(true);
    expect(openStatements()).toHaveLength(0);
  });

  it("defers and finalizes Kysely streams on full consumption, return and break", async () => {
    const unstarted = db.selectFrom("thing").selectAll().stream();
    expect(statements).toHaveLength(0);
    await unstarted.return?.();
    expect(statements).toHaveLength(0);
    const full = [];
    for await (const row of db.selectFrom("thing").select("id").orderBy("id").stream()) {
      full.push(row.id);
    }
    expect(full).toEqual([1, 2]);
    expect(openStatements()).toHaveLength(0);
    const partial = db.selectFrom("thing").selectAll().stream();
    await partial.next();
    expect(openStatements()).toHaveLength(1);
    await partial.return?.();
    expect(openStatements()).toHaveLength(0);
    for await (const row of db.selectFrom("thing").select("id").stream()) {
      expect(row.id).toBe(1);
      break;
    }
    expect(openStatements()).toHaveLength(0);
  });

  it("finalizes streams on callback exceptions, consumer exceptions and abort", async () => {
    raw.function("fail_second", (id: number) => {
      if (id === 2) throw new Error("row callback failed");
      return id;
    });
    const broken = db
      .selectFrom("thing")
      .select(sql<number>`fail_second(id)`.as("n"))
      .stream();
    expect((await broken.next()).value.n).toBe(1);
    await rejects(broken.next(), /row callback failed/);
    expect(openStatements()).toHaveLength(0);
    await rejects(
      (async () => {
        for await (const row of db.selectFrom("thing").selectAll().stream()) {
          expect(row.id).toBe(1);
          throw new Error("consumer failed");
        }
      })(),
      /consumer failed/,
    );
    expect(openStatements()).toHaveLength(0);
    const controller = new AbortController();
    const aborted = db.selectFrom("thing").selectAll().stream({
      chunkSize: 1,
      signal: controller.signal,
    });
    await aborted.next();
    controller.abort(new Error("stream stopped"));
    await rejects(aborted.next(), /stream stopped/);
    expect(openStatements()).toHaveLength(0);
  });

  it("does not prepare the unsupported write stream rejected by Kysely", async () => {
    const stream = db
      .insertInto("thing")
      .values({ id: 3, name: "three", data: new Uint8Array() })
      .stream();
    await rejects(stream.next(), /only supports streaming/);
    expect(statements).toHaveLength(0);
  });

  it("finalizes transaction controls, rollback and savepoint statements", async () => {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("thing").set({ name: "committed" }).where("id", "=", 1).execute();
    });
    expect(openStatements()).toHaveLength(0);
    await rejects(
      db.transaction().execute(async (trx) => {
        await trx.updateTable("thing").set({ name: "rolled back" }).where("id", "=", 1).execute();
        throw new Error("rollback");
      }),
      /rollback/,
    );
    const trx = await db.startTransaction().execute();
    const savepoint = await trx.savepoint("sp").execute();
    await savepoint.updateTable("thing").set({ name: "savepoint" }).where("id", "=", 1).execute();
    await savepoint.rollbackToSavepoint("sp").execute();
    await savepoint.releaseSavepoint("sp").execute();
    await trx.commit().execute();
    const row = await db
      .selectFrom("thing")
      .select("name")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    expect(row.name).toBe("committed");
    expect(preparedSql).toContain("begin immediate");
    expect(openStatements()).toHaveLength(0);
  });

  it("reprepares reusable queries after schema changes and fails cleanly after close", async () => {
    const stmt = adapter.prepare("SELECT * FROM thing WHERE id=1");
    expect(stmt.reader).toBe(true);
    expect(stmt.all([])).toHaveLength(1);
    adapter.prepare("ALTER TABLE thing ADD COLUMN note TEXT DEFAULT 'new'").run([]);
    expect(stmt.all([])).toEqual([
      { id: 1, name: "one", data: new Uint8Array([1, 2, 3]), note: "new" },
    ]);
    expect(openStatements()).toHaveLength(0);
    adapter.close();
    expect(() => stmt.all([])).toThrow(/closed/);
    expect(openStatements()).toHaveLength(0);
  });
});
