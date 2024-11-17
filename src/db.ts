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
  book_review: BookReview;
  auth_session: AuthSession;
  auth_state: AuthState;
};

export type Book = {
  uri: string;
  cid: string;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  status: string | null;
  author: string;
  title: string;
  cover: string | null;
  year: number | null;
  isbn: string | null;
};

export type BookReview = {
  uri: string;
  cid: string;
  authorDid: string;
  createdAt: string;
  indexedAt: string;
  bookUri: string;
  bookCid: string;
  commentUri: string | null;
  commentCid: string | null;
  stars: number | null;
};

export type AuthSession = {
  key: string;
  session: AuthSessionJson;
};

export type AuthState = {
  key: string;
  state: AuthStateJson;
};

type AuthStateJson = string;

type AuthSessionJson = string;

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
      .addColumn("status", "varchar")
      .addColumn("cover", "varchar")
      .addColumn("year", "integer")
      .addColumn("isbn", "varchar")
      .execute();
    await db.schema
      .createTable("book_review")
      .addColumn("uri", "varchar", (col) => col.primaryKey())
      .addColumn("cid", "varchar", (col) => col.notNull())
      .addColumn("authorDid", "varchar", (col) => col.notNull())
      .addColumn("createdAt", "varchar", (col) => col.notNull())
      .addColumn("indexedAt", "varchar", (col) => col.notNull())
      .addColumn("bookUri", "varchar", (col) => col.notNull())
      .addColumn("bookCid", "varchar", (col) => col.notNull())
      .addColumn("commentUri", "varchar")
      .addColumn("commentCid", "varchar")
      .addColumn("stars", "int8")
      .execute();
    await db.schema
      .createTable("auth_session")
      .addColumn("key", "varchar", (col) => col.primaryKey())
      .addColumn("session", "varchar", (col) => col.notNull())
      .execute();
    await db.schema
      .createTable("auth_state")
      .addColumn("key", "varchar", (col) => col.primaryKey())
      .addColumn("state", "varchar", (col) => col.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("auth_state").execute();
    await db.schema.dropTable("auth_session").execute();
    await db.schema.dropTable("book_review").execute();
    await db.schema.dropTable("book").execute();
  },
};

// APIs

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

export type Database = Kysely<DatabaseSchema>;
