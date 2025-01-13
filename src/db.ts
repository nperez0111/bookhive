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
  /**
   * Most recent time the book was indexed
   */
  indexedAt: string;
  /**
   * URI of the book
   */
  uri: string;
  /**
   * CID of the book
   */
  cid: string;
  /**
   * Hive ID of the book
   */
  hiveId: HiveId;
  /**
   * DID of the user who added the book
   */
  userDid: string;
  /**
   * Time the book was added
   */
  createdAt: string;
  /**
   * Status of the book
   */
  status: string | null;
  /**
   * Started reading at
   */
  startedAt: string | null;
  /**
   * Finished reading at
   */
  finishedAt: string | null;
  /**
   * Book title
   */
  title: string;
  /**
   * Authors are stored as a tab-separated string
   */
  authors: string;
  /**
   * Rating out of 10
   */
  stars: number | null;
  /**
   * Review of the book
   */
  review: string | null;
};

export type Buzz = {
  /**
   * Time the buzz was indexed
   */
  indexedAt: string;
  /**
   * URI of the buzz
   */
  uri: string;
  /**
   * CID of the buzz
   */
  cid: string;
  /**
   * DID of the user who added the buzz
   */
  userDid: string;
  /**
   * Time the buzz was added
   */
  createdAt: string;
  /**
   * Actual comment content
   */
  comment: string;
  /**
   * The book being buzzed about
   */
  bookUri: string;
  /**
   * CID of the book being buzzed about
   */
  bookCid: string;
  /**
   * The book's hive ID
   */
  hiveId: HiveId;
  /**
   * URI of the parent buzz or review
   */
  parentUri: string;
  /**
   * CID of the parent buzz or review
   */
  parentCid: string;
};

export type HiveBook = {
  id: HiveId;
  title: string;
  /**
   * Authors are stored as a tab-separated string
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

type Simplify<T> = { [K in keyof T]: T[K] };

type HiveFields = Pick<
  HiveBook,
  "cover" | "thumbnail" | "description" | "rating"
>;
/**
 * This is the result of a user's actual PDS data which may or may not include Hive data
 */
export type Book = Simplify<
  UserBook & {
    [K in keyof HiveFields]: HiveFields[K] | null;
  }
>;

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
