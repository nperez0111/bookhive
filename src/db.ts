import SqliteDb from "better-sqlite3";
import {
  Kysely,
  Migrator,
  SqliteDialect,
  sql,
  type Migration,
  type MigrationProvider,
} from "kysely";
import type {
  BookIdMap,
  Buzz,
  HiveBook,
  UserBookRow,
  UserFollow,
} from "./types";

// Types
export type DatabaseSchema = {
  hive_book: HiveBook;
  book_id_map: BookIdMap;
  user_book: UserBookRow;
  buzz: Buzz;
  user_follows: UserFollow;
};

export const BookFields = [
  "user_book.authors",
  "user_book.cid",
  "user_book.createdAt",
  "user_book.finishedAt",
  "user_book.hiveId",
  "user_book.indexedAt",
  "user_book.review",
  "user_book.stars",
  "user_book.startedAt",
  "user_book.status",
  "user_book.title",
  "user_book.uri",
  "user_book.userDid",
  "user_book.bookProgress",
  "hive_book.cover",
  "hive_book.thumbnail",
  "hive_book.description",
  "hive_book.rating",
  "hive_book.rawTitle",
] as const;

// Migrations

const migrations: Record<string, Migration> = {};

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

migrations["001"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("user_book")
      .addColumn("uri", "text", (col) => col.primaryKey())
      .addColumn("cid", "text", (col) => col.notNull())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("title", "text", (col) => col.notNull())
      .addColumn("authors", "text", (col) => col.notNull())
      .addColumn("status", "text")
      .addColumn("startedAt", "text")
      .addColumn("finishedAt", "text")
      .addColumn("stars", "int8")
      .addColumn("review", "text")
      .execute();
    await db.schema
      .createTable("hive_book")
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("title", "text", (col) => col.notNull())
      .addColumn("authors", "text", (col) => col.notNull()) // JSON array
      .addColumn("source", "text", (col) => col.notNull())
      .addColumn("sourceUrl", "text")
      .addColumn("sourceId", "text")
      .addColumn("cover", "text")
      .addColumn("thumbnail", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("rating", "real")
      .addColumn("ratingsCount", "integer")
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("user_book").execute();
    await db.schema.dropTable("hive_book").execute();
  },
};
migrations["002"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("buzz")
      .addColumn("uri", "text", (col) => col.primaryKey())
      .addColumn("cid", "text", (col) => col.notNull())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .addColumn("comment", "text", (col) => col.notNull())
      .addColumn("bookUri", "text", (col) => col.notNull())
      .addColumn("bookCid", "text", (col) => col.notNull())
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("parentUri", "text", (col) => col.notNull())
      .addColumn("parentCid", "text", (col) => col.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("buzz").execute();
  },
};

migrations["003"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("hive_book")
      .addColumn("rawTitle", "text")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").dropColumn("rawTitle").execute();
  },
};

migrations["004"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("user_follows")
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("followsDid", "text", (col) => col.notNull())
      .addColumn("followedAt", "text", (col) => col.notNull())
      .addColumn("syncedAt", "text", (col) => col.notNull())
      .addColumn("lastSeenAt", "text", (col) => col.notNull())
      .addColumn("isActive", "integer", (col) => col.notNull().defaultTo(1))
      .execute();

    await db.schema
      .createIndex("idx_user_follows_primary")
      .on("user_follows")
      .columns(["userDid", "followsDid"])
      .unique()
      .execute();

    await db.schema
      .createIndex("idx_user_follows_user")
      .on("user_follows")
      .column("userDid")
      .execute();

    await db.schema
      .createIndex("idx_user_follows_synced")
      .on("user_follows")
      .columns(["userDid", "syncedAt"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("user_follows").execute();
  },
};

migrations["005"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("hive_book")
      .addColumn("genres", "text")
      .execute();

    await db.schema
      .alterTable("hive_book")
      .addColumn("series", "text")
      .execute();

    await db.schema.alterTable("hive_book").addColumn("meta", "text").execute();

    await db.schema
      .alterTable("hive_book")
      .addColumn("enrichedAt", "text")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").dropColumn("genres").execute();

    await db.schema.alterTable("hive_book").dropColumn("series").execute();

    await db.schema.alterTable("hive_book").dropColumn("meta").execute();

    await db.schema.alterTable("hive_book").dropColumn("enrichedAt").execute();
  },
};

migrations["006"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("user_book")
      .addColumn("bookProgress", "text")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable("user_book")
      .dropColumn("bookProgress")
      .execute();
  },
};

migrations["007"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("book_id_map")
      .addColumn("hiveId", "text", (col) => col.primaryKey())
      .addColumn("isbn", "text")
      .addColumn("isbn13", "text")
      .addColumn("goodreadsId", "text")
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex("idx_book_id_map_isbn")
      .on("book_id_map")
      .column("isbn")
      .execute();

    await db.schema
      .createIndex("idx_book_id_map_isbn13")
      .on("book_id_map")
      .column("isbn13")
      .execute();

    await db.schema
      .createIndex("idx_book_id_map_goodreads_id")
      .on("book_id_map")
      .column("goodreadsId")
      .execute();

    await sql`
      INSERT INTO book_id_map (hiveId, isbn, isbn13, goodreadsId, updatedAt)
      SELECT
        id,
        NULLIF(REPLACE(REPLACE(UPPER(CAST(json_extract(meta, '$.isbn') AS TEXT)), '-', ''), ' ', ''), ''),
        NULLIF(REPLACE(REPLACE(CAST(json_extract(meta, '$.isbn13') AS TEXT), '-', ''), ' ', ''), ''),
        CASE
          WHEN source = 'Goodreads' THEN NULLIF(
            CASE
              WHEN instr(COALESCE(sourceId, ''), '.') > 0 THEN substr(sourceId, 1, instr(sourceId, '.') - 1)
              ELSE sourceId
            END,
            ''
          )
          ELSE NULL
        END,
        updatedAt
      FROM hive_book
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("book_id_map").execute();
  },
};

// APIs

export const createDb = (location: string): Database => {
  const sqlite = new SqliteDb(location, { fileMustExist: false });

  // Enable WAL mode
  sqlite.pragma("journal_mode = WAL");

  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

export type Database = Kysely<DatabaseSchema>;
