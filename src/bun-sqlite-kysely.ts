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

function isReaderStatement(sql: string): boolean {
  return /^\s*SELECT\b/i.test(sql);
}

/**
 * Wraps bun:sqlite's Database to match the interface Kysely's SqliteDialect expects.
 */
export function wrapBunSqliteForKysely(
  db: DatabaseSync,
): KyselySqliteDatabase {
  return {
    close() {
      db.close();
    },
    prepare(sql: string): KyselySqliteStatement {
      const stmt = db.prepare(sql);
      const reader = isReaderStatement(sql);
      return {
        get reader() {
          return reader;
        },
        all(parameters: ReadonlyArray<unknown>) {
          return stmt.all(
            ...(parameters as (null | number | bigint | string | Uint8Array)[]),
          );
        },
        run(parameters: ReadonlyArray<unknown>) {
          return stmt.run(
            ...(parameters as (null | number | bigint | string | Uint8Array)[]),
          );
        },
        iterate(parameters: ReadonlyArray<unknown>) {
          return stmt.iterate(
            ...(parameters as (null | number | bigint | string | Uint8Array)[]),
          );
        },
      };
    },
  };
}
