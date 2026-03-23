import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely.js";
import {
  Kysely,
  Migrator,
  SqliteDialect,
  sql,
  type Migration,
  type MigrationProvider,
} from "kysely";
import { Database as DatabaseSync } from "bun:sqlite";
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
import { deriveBookIdentifiers } from "./utils/bookIdentifiers.js";

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
    await db.schema.alterTable("hive_book").addColumn("rawTitle", "text").execute();
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
    await db.schema.alterTable("hive_book").addColumn("genres", "text").execute();

    await db.schema.alterTable("hive_book").addColumn("series", "text").execute();

    await db.schema.alterTable("hive_book").addColumn("meta", "text").execute();

    await db.schema.alterTable("hive_book").addColumn("enrichedAt", "text").execute();
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
    await db.schema.alterTable("user_book").addColumn("bookProgress", "text").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("user_book").dropColumn("bookProgress").execute();
  },
};

migrations["008"] = {
  async up(db: Kysely<unknown>) {
    // Speeds up "latest buzzes" and any query ordering by user_book.createdAt
    await db.schema
      .createIndex("idx_user_book_created_at")
      .on("user_book")
      .column("createdAt")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex("idx_user_book_created_at").on("user_book").execute();
  },
};

migrations["007"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").addColumn("identifiers", "text").execute();

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
    await db.schema.alterTable("hive_book").dropColumn("identifiers").execute();
  },
};

migrations["009"] = {
  async up(db: Kysely<unknown>) {
    // Denormalized genre list so /genres can avoid full scan + json_each on hive_book
    await db.schema
      .createTable("hive_book_genre")
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("genre", "text", (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex("idx_hive_book_genre_genre")
      .on("hive_book_genre")
      .column("genre")
      .execute();

    await db.schema
      .createIndex("idx_hive_book_genre_hive_id")
      .on("hive_book_genre")
      .column("hiveId")
      .execute();

    await sql`
      INSERT INTO hive_book_genre (hiveId, genre)
      SELECT hive_book.id, json_each.value
      FROM hive_book, json_each(hive_book.genres)
      WHERE hive_book.genres IS NOT NULL
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("hive_book_genre").execute();
  },
};

migrations["011"] = {
  async up(db: Kysely<unknown>) {
    // Thumbnail query: ORDER BY ratingsCount DESC WHERE thumbnail IS NOT NULL
    // Without this index: SCAN hive_book (123k rows) + USE TEMP B-TREE FOR ORDER BY
    // With this index: direct index scan, no sort needed
    await sql`CREATE INDEX IF NOT EXISTS idx_hive_book_ratings_thumbnail
      ON hive_book(ratingsCount DESC, authors, thumbnail)
      WHERE thumbnail IS NOT NULL AND thumbnail != ''`.execute(db);

    // Stats/author query: GROUP BY computed first-author expression + ORDER BY SUM(ratingsCount)
    // Covering index lets SQLite avoid reading the full row; reduces I/O from ~10MB to ~2MB
    await sql`CREATE INDEX IF NOT EXISTS idx_hive_book_author_ratings
      ON hive_book(authors, ratingsCount, rating)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP INDEX IF EXISTS idx_hive_book_ratings_thumbnail`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_hive_book_author_ratings`.execute(db);
  },
};

migrations["012"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").addColumn("hiveBookAtUri", "text").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").dropColumn("hiveBookAtUri").execute();
  },
};

migrations["013"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").addColumn("hiveBookCatalogUpdatedAt", "text").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").dropColumn("hiveBookCatalogUpdatedAt").execute();
  },
};

migrations["010"] = {
  async up(db: Kysely<unknown>) {
    const MIGRATION_010_BATCH_SIZE = 500;
    // Backfill book_id_map.goodreadsId from hive_book (source/sourceId/sourceUrl)
    // so goodreadsId matches the canonical id from hive_book.
    // Batched reads (LIMIT/OFFSET) + one UPDATE per batch (CASE) to avoid loading
    // the full table and per-row round-trips.
    const updatedAt = new Date().toISOString();
    let offset = 0;
    let batch: {
      id: string;
      source: string | null;
      sourceId: string | null;
      sourceUrl: string | null;
      meta: string | null;
    }[];
    do {
      batch = await db
        // @ts-ignore
        .selectFrom("hive_book")
        .select(["id", "source", "sourceId", "sourceUrl", "meta"])
        .orderBy("id")
        .limit(MIGRATION_010_BATCH_SIZE)
        .offset(offset)
        .execute();
      if (batch.length === 0) break;
      const updates = batch.map((row) => ({
        hiveId: row.id as HiveId,
        goodreadsId: deriveBookIdentifiers(row as Parameters<typeof deriveBookIdentifiers>[0])
          .goodreadsId as string | null,
      }));
      const hiveIds = updates.map((u) => u.hiveId) as HiveId[];
      const caseFragments = updates.map((u) => sql`WHEN ${u.hiveId} THEN ${u.goodreadsId}`);
      await db
        // @ts-ignore - migration uses unknown schema; set uses raw CASE, where uses hiveIds
        .updateTable("book_id_map")
        .set({
          goodreadsId: sql`CASE hiveId ${sql.join(caseFragments, sql` `)} END`,
          updatedAt: sql`${updatedAt}`,
        })
        // @ts-ignore - Kysely<unknown> rejects hiveId[] in where
        .where("hiveId", "in", hiveIds)
        .execute();
      offset += batch.length;
    } while (batch.length === MIGRATION_010_BATCH_SIZE);
  },
  async down(_db: Kysely<unknown>) {
    // No reversible fix; goodreadsId was wrong before.
  },
};

migrations["015"] = {
  async up(db: Kysely<unknown>) {
    // Profile page: WHERE userDid = ? ORDER BY createdAt DESC — was full scan
    await db.schema
      .createIndex("idx_user_book_user_did")
      .on("user_book")
      .column("userDid")
      .execute();

    // Book detail + rating stats: WHERE hiveId = ? — was full scan
    await db.schema.createIndex("idx_user_book_hive_id").on("user_book").column("hiveId").execute();

    // Feed page: WHERE userDid IN (follows) ORDER BY createdAt DESC — covers filter + sort
    await db.schema
      .createIndex("idx_user_book_user_created")
      .on("user_book")
      .columns(["userDid", "createdAt"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex("idx_user_book_user_did").on("user_book").execute();
    await db.schema.dropIndex("idx_user_book_hive_id").on("user_book").execute();
    await db.schema.dropIndex("idx_user_book_user_created").on("user_book").execute();
  },
};

migrations["016"] = {
  async up(db: Kysely<unknown>) {
    // genres JSON column is fully redundant with hive_book_genre table and is never
    // queried directly — dropping it shrinks hive_book by ~50-100 MB.
    // VACUUM must be run outside this transaction (see migrateToLatest).
    await db.schema.alterTable("hive_book").dropColumn("genres").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").addColumn("genres", "text").execute();
  },
};

migrations["017"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("user_book")
      .addColumn("owned", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
    await sql`UPDATE user_book SET owned = 1, status = NULL WHERE status = 'buzz.bookhive.defs#owned'`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("user_book").dropColumn("owned").execute();
  },
};

migrations["014"] = {
  async up(db: Kysely<unknown>) {
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
    await db.schema.dropTable("book_list_item").execute();
    await db.schema.dropTable("book_list").execute();
  },
};

// APIs

export const createDb = (
  location: string,
  opts?: { exclusive?: boolean },
): { db: Database; sqlite: DatabaseSync } => {
  const sqlite = new DatabaseSync(location);
  sqlite.exec("PRAGMA journal_mode = WAL");
  if (opts?.exclusive) {
    sqlite.exec("PRAGMA locking_mode = EXCLUSIVE");
  }
  sqlite.exec("PRAGMA synchronous = NORMAL"); // safe with WAL; skips redundant fsyncs
  sqlite.exec("PRAGMA cache_size = -65536"); // 64 MB page cache (default is ~2 MB)
  sqlite.exec("PRAGMA temp_store = MEMORY"); // temp B-trees (sorts, GROUP BY) in RAM
  // mmap intentionally omitted: prod DB is ~800 MB and growing; mmap_size = 0 (default)
  // keeps memory usage bounded and predictable. The 64 MB page cache covers the full
  // hot index working set (~56 MB: genre + thumbnail + author-ratings indexes).

  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });

  return { db, sqlite };
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return results ?? [];
};

export type Database = Kysely<DatabaseSchema>;

/** Keep hive_book_genre in sync when hive_book.genres is updated (used by enrichBookData). */
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
