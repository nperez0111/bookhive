import { defineDriver } from "unstorage";
import { Kysely, PostgresDialect } from "kysely";
import type pg from "pg";

interface TableSchema {
  [k: string]: {
    id: string;
    value: string;
    created_at: string;
    updated_at: string;
  };
}

export type KvDb = Kysely<TableSchema>;

const DRIVER_NAME = "pg-kv";

export default defineDriver<
  {
    table: string;
    pool: pg.Pool;
  },
  KvDb
>(({ table, pool }) => {
  let _db: KvDb | null = null;
  let _tableReady: Promise<void> | null = null;

  function getDb(): KvDb {
    if (!_db) {
      _db = new Kysely<TableSchema>({
        dialect: new PostgresDialect({ pool }),
      });
    }
    return _db;
  }

  function ensureTable(): Promise<void> {
    if (!_tableReady) {
      _tableReady = getDb()
        .schema.createTable(table)
        .ifNotExists()
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("value", "text", (col) => col.notNull())
        .addColumn("created_at", "text", (col) => col.notNull())
        .addColumn("updated_at", "text", (col) => col.notNull())
        .execute()
        .then(() => {});
    }
    return _tableReady;
  }

  return {
    name: DRIVER_NAME,
    options: { table, pool },
    getInstance: getDb,

    async hasItem(key) {
      await ensureTable();
      const result = await getDb()
        .selectFrom(table)
        .select(["id"])
        .where("id", "=", key)
        .executeTakeFirst();
      return !!result;
    },

    async getItem(key) {
      await ensureTable();
      const result = await getDb()
        .selectFrom(table)
        .select(["value"])
        .where("id", "=", key)
        .executeTakeFirst();
      return result?.value ?? null;
    },

    async setItem(key: string, value: string) {
      await ensureTable();
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
      await ensureTable();
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
      await ensureTable();
      await getDb().deleteFrom(table).where("id", "=", key).execute();
    },

    async getMeta(key: string) {
      await ensureTable();
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
      await ensureTable();
      const results = await getDb()
        .selectFrom(table)
        .select(["id"])
        .where("id", "like", `${base}%`)
        .execute();
      return results.map((r) => r.id);
    },

    async clear() {
      await ensureTable();
      await getDb().deleteFrom(table).execute();
    },

    async dispose() {
      await getDb().destroy();
    },
  };
});
