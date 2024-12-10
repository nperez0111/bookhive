import { defineDriver } from "unstorage";
import { Kysely, SqliteDialect } from "kysely";
import Database from "better-sqlite3";

interface TableSchema {
  [k: string]: {
    id: string;
    value: string;
    created_at: string;
    updated_at: string;
  };
}

export type KvDb = Kysely<TableSchema>;

const DRIVER_NAME = "sqlite";

export default defineDriver<
  {
    location?: string;
    table: string;
    getDb?: () => KvDb;
  },
  KvDb
>(
  ({
    location,
    table = "kv",
    getDb = (): KvDb => {
      let _db: KvDb | null = null;

      return (() => {
        if (_db) {
          return _db;
        }

        if (!location) {
          throw new Error("SQLite location is required");
        }

        const sqlite = new Database(location, { fileMustExist: false });

        // Enable WAL mode
        sqlite.pragma("journal_mode = WAL");

        _db = new Kysely<TableSchema>({
          dialect: new SqliteDialect({
            database: sqlite,
          }),
        });

        // Create table if not exists
        _db.schema
          .createTable(table)
          .ifNotExists()
          .addColumn("id", "text", (col) => col.primaryKey())
          .addColumn("value", "text", (col) => col.notNull())
          .addColumn("created_at", "text", (col) => col.notNull())
          .addColumn("updated_at", "text", (col) => col.notNull())
          .execute();

        return _db;
      })();
    },
  }) => {
    return {
      name: DRIVER_NAME,
      options: { location, table },
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
            oc.column("id").doUpdateSet({
              value,
              updated_at: now,
            }),
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
        return {
          birthtime: new Date(result.created_at),
          mtime: new Date(result.updated_at),
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
  },
);
