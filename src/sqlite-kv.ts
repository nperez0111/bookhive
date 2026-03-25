import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely.js";
import { defineDriver } from "unstorage";
import { Kysely, SqliteDialect } from "kysely";
import { Database as DatabaseSync } from "bun:sqlite";

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
 * Pass the result to multiple sqliteKv drivers via the `db` option to avoid
 * multiple exclusive-locked connections to the same file (which causes SQLITE_BUSY).
 */
export function createSharedKvDb(location: string, exclusive?: boolean): KvDb {
  const sqlite = new DatabaseSync(location);
  if (exclusive) {
    sqlite.exec("PRAGMA locking_mode = EXCLUSIVE");
  }
  sqlite.exec("PRAGMA journal_mode = WAL");
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
    exclusive?: boolean;
    /** Pre-created shared KvDb connection. Use this when multiple drivers share the same SQLite file. */
    db?: KvDb;
  },
  KvDb
>(({ location, table = "kv", exclusive, db: sharedDb }) => {
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
      if (exclusive) {
        sqlite.exec("PRAGMA locking_mode = EXCLUSIVE");
      }
      sqlite.exec("PRAGMA journal_mode = WAL");
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

      await getDb()
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
        });
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
