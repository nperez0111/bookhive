/**
 * Wraps Bun's built-in `bun:sqlite` Database so it can be used with
 * Kysely's built-in SqliteDialect (which expects a better-sqlite3-like interface).
 */
import { Database as DatabaseSync } from "bun:sqlite";

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
 */
function isReaderStatement(sql: string): boolean {
  return /^\s*SELECT\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
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
      const stmt = db.prepare(sql);
      const reader = isReaderStatement(sql);
      return {
        get reader() {
          return reader;
        },
        all(parameters: ReadonlyArray<unknown>) {
          return stmt.all(...(parameters as (null | number | bigint | string | Uint8Array)[]));
        },
        run(parameters: ReadonlyArray<unknown>) {
          return stmt.run(...(parameters as (null | number | bigint | string | Uint8Array)[]));
        },
        iterate(parameters: ReadonlyArray<unknown>) {
          return stmt.iterate(...(parameters as (null | number | bigint | string | Uint8Array)[]));
        },
      };
    },
  };
}
