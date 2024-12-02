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
  book: Book;
  buzz: Buzz;
};

export type Book = {
  uri: string;
  cid: string;
  hiveId: string;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  author: string;
  title: string;
  year: number | null;
};

export type Buzz = {
  uri: string;
  cid: string;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  bookUri: string;
  bookCid: string;
  hiveId: string | null;
  commentUri: string | null;
  commentCid: string | null;
  stars: number | null;
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
      .createTable("book")
      .addColumn("uri", "varchar", (col) => col.primaryKey())
      .addColumn("cid", "varchar", (col) => col.notNull())
      .addColumn("authorDid", "varchar", (col) => col.notNull())
      .addColumn("createdAt", "varchar", (col) => col.notNull())
      .addColumn("indexedAt", "varchar", (col) => col.notNull())
      .addColumn("author", "varchar", (col) => col.notNull())
      .addColumn("title", "varchar", (col) => col.notNull())
      .addColumn("hiveId", "varchar", (col) => col.notNull())
      .addColumn("status", "varchar")
      .addColumn("startedAt", "varchar")
      .addColumn("finishedAt", "varchar")
      .addColumn("year", "integer")
      .execute();
    await db.schema
      .createTable("buzz")
      .addColumn("uri", "varchar", (col) => col.primaryKey())
      .addColumn("cid", "varchar", (col) => col.notNull())
      .addColumn("authorDid", "varchar", (col) => col.notNull())
      .addColumn("createdAt", "varchar", (col) => col.notNull())
      .addColumn("indexedAt", "varchar", (col) => col.notNull())
      .addColumn("bookUri", "varchar", (col) => col.notNull())
      .addColumn("bookCid", "varchar", (col) => col.notNull())
      .addColumn("hiveId", "varchar")
      .addColumn("commentUri", "varchar")
      .addColumn("commentCid", "varchar")
      .addColumn("stars", "int8")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("buzz").execute();
    await db.schema.dropTable("book").execute();
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
