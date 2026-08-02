import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely.js";
import { defineDriver } from "unstorage";
import { Kysely, SqliteDialect } from "kysely";
import { Database as DatabaseSync } from "bun:sqlite";

function applyStandardPragmas(sqlite: DatabaseSync) {
  // 10s: four cluster processes share this file, and a write can queue behind
  // another process's checkpoint.
  sqlite.exec("PRAGMA busy_timeout = 10000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
}

/** Numeric SQLite result codes: SQLITE_BUSY and SQLITE_BUSY_SNAPSHOT. */
const BUSY_ERRNOS = new Set([5, 517]);

/** SQLITE_BUSY that survived busy_timeout — retry a whole transaction. */
function isBusyError(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown; errcode?: unknown } | null;
  if (e?.code === "SQLITE_BUSY" || e?.code === "SQLITE_BUSY_SNAPSHOT") return true;
  // bun:sqlite exposes `errno`; node:sqlite uses `errcode`.
  for (const numeric of [e?.errno, e?.errcode]) {
    if (typeof numeric === "number" && BUSY_ERRNOS.has(numeric)) return true;
  }
  return /database is locked/i.test((err as Error)?.message ?? "");
}

/**
 * Each attempt can itself block for up to `busy_timeout` (10s), so a plain
 * attempt count could hold a request for ~30s. Bound the whole thing instead:
 * once the budget is spent, propagate the busy error rather than queueing
 * further behind sustained contention.
 */
const BUSY_RETRY_BUDGET_MS = 12_000;

async function withBusyRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  const deadline = Date.now() + BUSY_RETRY_BUDGET_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isBusyError(err)) throw err;
      const backoff = 25 * 2 ** (attempt - 1) + Math.floor(Math.random() * 25);
      if (Date.now() + backoff >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      if (Date.now() >= deadline) throw err;
    }
  }
}

interface TableSchema {
  [k: string]: {
    id: string;
    value: string;
    created_at: string;
    updated_at: string;
  };
}

export type KvDb = Kysely<TableSchema>;

/**
 * Create a single shared KvDb connection for a SQLite file.
 * Pass the result to multiple sqliteKv drivers via the `db` option to share
 * a single connection to the same file.
 */
export function createSharedKvDb(location: string): KvDb {
  const sqlite = new DatabaseSync(location);
  applyStandardPragmas(sqlite);
  return new Kysely<TableSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });
}

const DRIVER_NAME = "sqlite";

export default defineDriver<
  {
    location?: string;
    table: string;
    /** Pre-created shared KvDb connection. Use this when multiple drivers share the same SQLite file. */
    db?: KvDb;
  },
  KvDb
>(({ location, table, db: sharedDb }) => {
  // _db is a per-driver-instance singleton — must live outside any function body
  // so it is not re-initialized on every getDb() call.
  let _db: KvDb | null = sharedDb ?? null;
  let _tableCreated = false;

  function getDb(): KvDb {
    if (!_db) {
      if (!location) {
        throw new Error("SQLite location is required");
      }
      const sqlite = new DatabaseSync(location);
      applyStandardPragmas(sqlite);
      _db = new Kysely<TableSchema>({
        dialect: new SqliteDialect({
          database: wrapBunSqliteForKysely(sqlite),
        }),
      });
    }

    if (!_tableCreated) {
      _tableCreated = true;
      // Create table if not exists (idempotent — safe to run on every cold start)
      void _db.schema
        .createTable(table)
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("value", "text", (col) => col.notNull())
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute();
    }

    return _db;
  }

  return {
    name: DRIVER_NAME,
    options: { ...(location !== undefined ? { location } : {}), table },
    getInstance: getDb,

    async hasItem(key) {
      const result = await getDb()
        .selectFrom(table)
        .select(["id"])
        .where("id", "=", key)
        .executeTakeFirst();
      return !!result;
    },

    async getItem(key) {
      const result = await getDb()
        .selectFrom(table)
        .select(["value"])
        .where("id", "=", key)
        .executeTakeFirst();
      return result?.value ?? null;
    },

    async setItem(key: string, value: string) {
      const now = new Date().toISOString();
      await getDb()
        .insertInto(table)
        .values({
          id: key,
          value,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet((c) => ({
            value: c.ref("excluded.value"),
            updated_at: c.ref("excluded.updated_at"),
          })),
        )
        .execute();
    },

    async setItems(items) {
      const now = new Date().toISOString();

      await withBusyRetry(() =>
        getDb()
          .transaction()
          .execute(async (trx) => {
            await Promise.all(
              items.map(({ key, value }) => {
                return trx
                  .insertInto(table)
                  .values({
                    id: key,
                    value,
                    created_at: now,
                    updated_at: now,
                  })
                  .onConflict((oc) =>
                    oc.column("id").doUpdateSet({
                      value,
                      updated_at: now,
                    }),
                  )
                  .execute();
              }),
            );
          }),
      );
    },

    async removeItem(key: string) {
      await getDb().deleteFrom(table).where("id", "=", key).execute();
    },

    async getMeta(key: string) {
      const result = await getDb()
        .selectFrom(table)
        .select(["created_at", "updated_at"])
        .where("id", "=", key)
        .executeTakeFirst();
      if (!result) {
        return null;
      }
      const mtime = new Date(result.updated_at);
      return {
        birthtime: new Date(result.created_at),
        mtime,
        /** Used by readThroughCache for TTL; setItem updates updated_at. */
        timestamp: mtime.getTime(),
      };
    },

    async getKeys(base = "") {
      const results = await getDb()
        .selectFrom(table)
        .select(["id"])
        .where("id", "like", `${base}%`)
        .execute();
      return results.map((r) => r.id);
    },

    async clear() {
      await getDb().deleteFrom(table).execute();
    },

    async dispose() {
      await getDb().destroy();
    },
  };
});
