import {
  Kysely,
  Migrator,
  PostgresDialect,
  sql,
  type Migration,
  type MigrationProvider,
} from "kysely";
import pg from "pg";
import type {
  BookIdentifiersRow,
  BookListRow,
  BookListItemRow,
  Buzz,
  HiveBook,
  HiveBookGenre,
  HiveId,
  UserBookRow,
  UserFollow,
} from "./types";

// Types
export type DatabaseSchema = {
  hive_book: HiveBook;
  hive_book_genre: HiveBookGenre;
  book_id_map: BookIdentifiersRow;
  user_book: UserBookRow;
  buzz: Buzz;
  user_follows: UserFollow;
  book_list: BookListRow;
  book_list_item: BookListItemRow;
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
  "user_book.owned",
  "user_book.title",
  "user_book.uri",
  "user_book.userDid",
  "user_book.bookProgress",
  "hive_book.cover",
  "hive_book.thumbnail",
  "hive_book.description",
  "hive_book.rating",
  "hive_book.ratingsCount",
  "hive_book.rawTitle",
] as const;

// Migrations — consolidated for PostgreSQL (fresh schema, no incremental SQLite history)

const migrations: Record<string, Migration> = {};

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

migrations["pg-001"] = {
  async up(db: Kysely<unknown>) {
    // -- user_book --
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
      .addColumn("stars", "integer")
      .addColumn("review", "text")
      .addColumn("bookProgress", "text")
      .addColumn("owned", "integer", (col) => col.notNull().defaultTo(0))
      .execute();

    await db.schema
      .createIndex("idx_user_book_created_at")
      .on("user_book")
      .column("createdAt")
      .execute();
    await db.schema
      .createIndex("idx_user_book_user_did")
      .on("user_book")
      .column("userDid")
      .execute();
    await db.schema.createIndex("idx_user_book_hive_id").on("user_book").column("hiveId").execute();
    await db.schema
      .createIndex("idx_user_book_user_created")
      .on("user_book")
      .columns(["userDid", "createdAt"])
      .execute();

    // -- hive_book --
    await db.schema
      .createTable("hive_book")
      .addColumn("id", "text", (col) => col.primaryKey())
      .addColumn("title", "text", (col) => col.notNull())
      .addColumn("authors", "text", (col) => col.notNull())
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
      .addColumn("rawTitle", "text")
      .addColumn("series", "text")
      .addColumn("meta", "text")
      .addColumn("enrichedAt", "text")
      .addColumn("identifiers", "text")
      .addColumn("hiveBookAtUri", "text")
      .addColumn("hiveBookCatalogUpdatedAt", "text")
      .execute();

    await sql`CREATE INDEX idx_hive_book_ratings_thumbnail
      ON hive_book("ratingsCount" DESC, authors, thumbnail)
      WHERE thumbnail IS NOT NULL AND thumbnail != ''`.execute(db);
    await sql`CREATE INDEX idx_hive_book_author_ratings
      ON hive_book(authors, "ratingsCount", rating)`.execute(db);

    // -- buzz --
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

    await sql`CREATE INDEX idx_buzz_hive_id ON buzz("hiveId", "createdAt")`.execute(db);
    await sql`CREATE INDEX idx_buzz_parent_uri ON buzz("parentUri")`.execute(db);

    // -- user_follows --
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
      .createIndex("idx_user_follows_synced")
      .on("user_follows")
      .columns(["userDid", "syncedAt"])
      .execute();
    await db.schema
      .createIndex("idx_user_follows_active")
      .on("user_follows")
      .columns(["userDid", "isActive", "followsDid"])
      .execute();

    // -- book_id_map --
    await db.schema
      .createTable("book_id_map")
      .addColumn("hiveId", "text", (col) => col.primaryKey())
      .addColumn("isbn", "text")
      .addColumn("isbn13", "text")
      .addColumn("goodreadsId", "text")
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();

    await db.schema.createIndex("idx_book_id_map_isbn").on("book_id_map").column("isbn").execute();
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

    // -- hive_book_genre (with serial id to replace SQLite rowid) --
    await db.schema
      .createTable("hive_book_genre")
      .addColumn("id", "serial", (col) => col.primaryKey())
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("genre", "text", (col) => col.notNull())
      .execute();

    await sql`CREATE UNIQUE INDEX idx_hive_book_genre_pk ON hive_book_genre("hiveId", genre)`.execute(
      db,
    );

    // -- book_list --
    await db.schema
      .createTable("book_list")
      .addColumn("uri", "text", (col) => col.primaryKey())
      .addColumn("cid", "text", (col) => col.notNull())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("name", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("ordered", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("tags", "text")
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .execute();

    await db.schema.createIndex("idx_book_list_user").on("book_list").column("userDid").execute();

    // -- book_list_item --
    await db.schema
      .createTable("book_list_item")
      .addColumn("uri", "text", (col) => col.primaryKey())
      .addColumn("cid", "text", (col) => col.notNull())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("listUri", "text", (col) => col.notNull())
      .addColumn("hiveId", "text")
      .addColumn("description", "text")
      .addColumn("position", "integer")
      .addColumn("addedAt", "text", (col) => col.notNull())
      .addColumn("indexedAt", "text", (col) => col.notNull())
      .addColumn("embeddedTitle", "text")
      .addColumn("embeddedAuthor", "text")
      .addColumn("embeddedCoverUrl", "text")
      .addColumn("identifiers", "text")
      .execute();

    await db.schema
      .createIndex("idx_book_list_item_list")
      .on("book_list_item")
      .column("listUri")
      .execute();
    await db.schema
      .createIndex("idx_book_list_item_hive")
      .on("book_list_item")
      .column("hiveId")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("book_list_item").ifExists().execute();
    await db.schema.dropTable("book_list").ifExists().execute();
    await db.schema.dropTable("hive_book_genre").ifExists().execute();
    await db.schema.dropTable("book_id_map").ifExists().execute();
    await db.schema.dropTable("user_follows").ifExists().execute();
    await db.schema.dropTable("buzz").ifExists().execute();
    await db.schema.dropTable("hive_book").ifExists().execute();
    await db.schema.dropTable("user_book").ifExists().execute();
  },
};

// APIs

export const createDb = (connectionString: string): { db: Database; pool: pg.Pool } => {
  const pool = new pg.Pool({
    connectionString,
    min: 2,
    max: 10,
  });

  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool,
    }),
  });

  return { db, pool };
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return results ?? [];
};

export type Database = Kysely<DatabaseSchema>;

/** Replace hive_book_genre rows for a book from a scraped genre list (used by enrichBookData). */
export async function syncHiveBookGenres(
  db: Database,
  hiveId: HiveId,
  genresJson: string | null,
): Promise<void> {
  await db.deleteFrom("hive_book_genre").where("hiveId", "=", hiveId).execute();
  if (!genresJson) return;
  const genres: string[] = JSON.parse(genresJson);
  if (genres.length === 0) return;
  await db
    .insertInto("hive_book_genre")
    .values(genres.map((genre) => ({ hiveId, genre })))
    .execute();
}
