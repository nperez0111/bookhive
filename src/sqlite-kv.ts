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
/** Returns the raw handle alongside Kysely, matching `createDb` in src/db.ts —
 *  VACUUM and PRAGMA work needs the connection, not the query builder. */
export function createSharedKvDb(location: string): { db: KvDb; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(location);
  applyStandardPragmas(sqlite);
  const db = new Kysely<TableSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });
  return { db, sqlite };
}

/** Reclaim below this and it isn't worth the rewrite. */
export const VACUUM_FREELIST_RATIO = 0.25;

/**
 * Reclaim free pages in the KV file, and switch it to incremental auto-vacuum
 * so this stops being necessary.
 *
 * The KV is a delete-heavy workload — the page and OG caches churn constantly
 * and the primary worker sweeps both every 15 minutes — but nothing ever
 * VACUUMed it and `auto_vacuum` was never set. Measured on production
 * 2026-08-02: **1.94 GB on disk holding 34.7 MB of live data, 98.1% free
 * pages.** That is 1.9 GB of page-cache pressure inside a memory-limited
 * cgroup, for nothing.
 *
 * A full VACUUM of that file took 1.36s. Cheap enough to do on every deploy,
 * but gated on the ratio so a healthy file isn't rewritten for no reason.
 * `auto_vacuum = INCREMENTAL` only takes effect after a VACUUM, which is why
 * the pragma is set first and the two always run together.
 */
export function vacuumKvIfBloated(
  sqlite: DatabaseSync,
  log: (fields: Record<string, unknown>, msg: string) => void,
): void {
  const pageCount = readPragma(sqlite, "page_count");
  const freelist = readPragma(sqlite, "freelist_count");
  const pageSize = readPragma(sqlite, "page_size");
  const autoVacuum = readPragma(sqlite, "auto_vacuum");
  if (pageCount === 0) return;

  const ratio = freelist / pageCount;
  // 0 = NONE, 1 = FULL, 2 = INCREMENTAL.
  if (ratio < VACUUM_FREELIST_RATIO && autoVacuum === 2) return;

  const startedAt = Date.now();
  const beforeBytes = pageCount * pageSize;
  try {
    if (autoVacuum !== 2) sqlite.exec("PRAGMA auto_vacuum = INCREMENTAL");
    sqlite.exec("VACUUM");
  } catch (err) {
    // A crowded disk or a concurrent reader is not worth failing startup over.
    log({ err, freelist_ratio: ratio }, "kv VACUUM failed");
    return;
  }

  log(
    {
      durationMs: Date.now() - startedAt,
      freelist_ratio: Number(ratio.toFixed(3)),
      before_bytes: beforeBytes,
      after_bytes: readPragma(sqlite, "page_count") * pageSize,
    },
    "kv VACUUM complete",
  );
}

/**
 * Reclaim whatever the sweeps just freed. Bounded by `pages` so it can sit on a
 * periodic timer without ever becoming a long synchronous stall — unlike a full
 * VACUUM, which rewrites the file.
 */
export function incrementalVacuumKv(
  sqlite: DatabaseSync,
  pages = 1000,
  log?: (fields: Record<string, unknown>, msg: string) => void,
): void {
  // PRAGMA arguments cannot be bound, so this is string-interpolated — coerce
  // to a whole number rather than trusting every present and future caller to
  // pass one.
  const count = Math.max(1, Math.floor(Number(pages) || 0));
  try {
    sqlite.exec(`PRAGMA incremental_vacuum(${count})`);
  } catch (err) {
    // Expected no-op when auto_vacuum isn't INCREMENTAL yet; anything else is
    // worth a line, since this runs on a timer where silence is the default.
    log?.({ err }, "kv incremental_vacuum failed");
  }
}

export function readPragma(sqlite: DatabaseSync, name: string): number {
  const row = sqlite.query(`PRAGMA ${name}`).get() as Record<string, number> | null;
  return row ? (Object.values(row)[0] ?? 0) : 0;
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
