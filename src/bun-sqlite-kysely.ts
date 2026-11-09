/**
 * Wraps Bun's built-in `bun:sqlite` Database so it can be used with
 * Kysely's built-in SqliteDialect (which expects a better-sqlite3-like interface).
 */
import { Database as DatabaseSync, type SQLQueryBindings } from "bun:sqlite";

export interface KyselySqliteDatabase {
  close(): void;
  prepare(sql: string): KyselySqliteStatement;
}

export interface KyselySqliteStatement {
  readonly reader: boolean;
  all(parameters: ReadonlyArray<unknown>): unknown[];
  run(parameters: ReadonlyArray<unknown>): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown>;
}

/**
 * Kysely's SqliteDialect uses `statement.reader` to choose between `all()` (row
 * results) and `run()` (changes + lastInsertRowid). Any statement that produces
 * rows must report true — including `INSERT`/`UPDATE`/`DELETE ... RETURNING`
 * (SQLite >= 3.35), which otherwise executes fine but hands Kysely zero rows, so
 * `.returning(...).executeTakeFirstOrThrow()` fails with "no result".
 *
 * Bun 1.4.4's native `reader` asks SQLite for the column count without allocating
 * column-name arrays. The installed Bun types predate that getter, so keep the
 * typed `columnNames` fallback for runtimes without it.
 *
 * This used to be `/^\s*SELECT\b/` plus a RETURNING check, which got
 * `WITH cte AS (...) SELECT ...` wrong — a leading CTE is extremely common for
 * window-function queries, and misclassifying one produces **zero rows with no
 * error at all**. SQLite also gets the converse right, where a regex
 * struggles: `WITH cte AS (...) INSERT INTO ...` is not a reader.
 */
function isReaderStatement(stmt: {
  readonly reader?: boolean;
  readonly columnNames: string[];
}): boolean {
  const reader = stmt.reader;
  return typeof reader === "boolean" ? reader : stmt.columnNames.length > 0;
}

type NativeStatement = ReturnType<DatabaseSync["prepare"]>;

function finalizeStatement(stmt: NativeStatement, executionFailed: boolean): void {
  try {
    stmt.finalize();
  } catch (error) {
    // Cleanup must not replace the SQL/binding/iteration error that caused it.
    if (!executionFailed) throw error;
  }
}

/**
 * Kysely opens transactions with a bare `begin`, which SQLite treats as
 * DEFERRED: the write lock is only taken when the first write executes. If
 * another process wrote in between, that upgrade fails with
 * SQLITE_BUSY_SNAPSHOT — and the busy handler is **not** invoked for that case,
 * so `PRAGMA busy_timeout` cannot save it. With four cluster processes on one
 * database file, that is the residual "database is locked" (48× in 24h on
 * 2026-08-01). BEGIN IMMEDIATE takes the write lock up front, where the busy
 * timeout does apply.
 */
export function toImmediateTransaction(sql: string): string {
  return /^\s*begin\s*;?\s*$/i.test(sql) ? "begin immediate" : sql;
}

/**
 * Wraps bun:sqlite's Database to match the interface Kysely's SqliteDialect expects.
 */
export function wrapBunSqliteForKysely(db: DatabaseSync): KyselySqliteDatabase {
  return {
    close() {
      db.close();
    },
    prepare(rawSql: string): KyselySqliteStatement {
      const sql = toImmediateTransaction(rawSql);
      // Kysely normally asks for reader, then executes once. Defer preparation
      // so rejected/nonstarted streams allocate nothing; reuse a metadata-only
      // statement on that first execution. Later calls get independent cursors
      // and fresh bindings; callers must supply each invocation's parameters.
      let pending: NativeStatement | undefined;
      let reader: boolean | undefined;
      const takeStatement = (): NativeStatement => {
        const stmt = pending ?? db.prepare(sql);
        pending = undefined;
        return stmt;
      };
      return {
        get reader() {
          if (reader === undefined) {
            const stmt = (pending ??= db.prepare(sql));
            try {
              reader = isReaderStatement(stmt);
            } catch (error) {
              pending = undefined;
              finalizeStatement(stmt, true);
              throw error;
            }
          }
          return reader;
        },
        all(parameters: ReadonlyArray<unknown>) {
          const stmt = takeStatement();
          let failed = false;
          try {
            return stmt.all(...(parameters as SQLQueryBindings[]));
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            finalizeStatement(stmt, failed);
          }
        },
        run(parameters: ReadonlyArray<unknown>) {
          const stmt = takeStatement();
          let failed = false;
          try {
            return stmt.run(...(parameters as SQLQueryBindings[]));
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            finalizeStatement(stmt, failed);
          }
        },
        *iterate(parameters: ReadonlyArray<unknown>) {
          // This runs on first next(), not when the deferred iterator is made.
          // yield* closes/resets Bun's cursor before our finally finalizes it.
          const stmt = takeStatement();
          let failed = false;
          try {
            yield* stmt.iterate(...(parameters as SQLQueryBindings[]));
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            finalizeStatement(stmt, failed);
          }
        },
      };
    },
  };
}
