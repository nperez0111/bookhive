import SqliteDb from "better-sqlite3";
import {
  Kysely,
  Migrator,
  SqliteDialect,
  type Migration,
  type MigrationProvider,
} from "kysely";

// Types
export type DatabaseSchema = {
  hive_book: HiveBook;
  user_book: UserBook;
  buzz: Buzz;
};

/**
 * Hive ID is a hash of the book's title & author
 * Used to uniquely identify a book within the hive
 */
export type HiveId = `bk_${string}`;

export type UserBook = {
  uri: string;
  cid: string;
  hiveId: HiveId;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type Buzz = {
  uri: string;
  cid: string;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  bookUri: string;
  bookCid: string;
  hiveId: HiveId | null;
  commentUri: string | null;
  commentCid: string | null;
  stars: number | null;
};

export type HiveBook = {
  id: HiveId;
  title: string;
  /**
   * Authors are stored as a JSON array string
   */
  authors: string;
  source: string;
  sourceUrl: string | null;
  sourceId: string | null;
  cover: string | null;
  thumbnail: string;
  description: string | null;
  rating: number | null;
  ratingsCount: number | null;
  createdAt: string;
  updatedAt: string;
};

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
      .addColumn("authorDid", "text", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("status", "text")
      .addColumn("startedAt", "text")
      .addColumn("finishedAt", "text")
      .execute();
    await db.schema
      .createTable("buzz")
      .addColumn("uri", "text", (col) => col.primaryKey())
      .addColumn("cid", "text", (col) => col.notNull())
      .addColumn("authorDid", "text", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .addColumn("bookUri", "text", (col) => col.notNull())
      .addColumn("bookCid", "text", (col) => col.notNull())
      .addColumn("hiveId", "text")
      .addColumn("commentUri", "text")
      .addColumn("commentCid", "text")
      .addColumn("stars", "int8")
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
    await db.schema.dropTable("buzz").execute();
    await db.schema.dropTable("user_book").execute();
    await db.schema.dropTable("hive_book").execute();
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
