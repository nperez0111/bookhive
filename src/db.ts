import SqliteDb from "better-sqlite3";
import {
  Kysely,
  Migrator,
  SqliteDialect,
  type Migration,
  type MigrationProvider,
} from "kysely";
import type { Buzz, HiveBook, UserBook } from "./types";

// Types
export type DatabaseSchema = {
  hive_book: HiveBook;
  user_book: UserBook;
  buzz: Buzz;
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
  "hive_book.cover",
  "hive_book.thumbnail",
  "hive_book.description",
  "hive_book.rating",
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
