import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely.js";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { Database as DatabaseSync } from "bun:sqlite";
import { env } from "./env";
import type {
  BookIdentifiersRow,
  BookListRow,
  BookListItemRow,
  Buzz,
  HiveBook,
  HiveBookGenre,
  HiveBookAuthor,
  HiveId,
  PersonalBookRow,
  PersonalShelfRow,
  PersonalShelfItemRow,
  SyncDocumentRow,
  UserBookRow,
  UserFollow,
} from "./types";
import { deriveBookIdentifiers } from "./utils/bookIdentifiers.js";
import { filenameKey, koreaderFilenameHash } from "./utils/filenameMatching.js";

// Types
export type DatabaseSchema = {
  hive_book: HiveBook;
  hive_book_genre: HiveBookGenre;
  hive_book_author: HiveBookAuthor;
  book_id_map: BookIdentifiersRow;
  user_book: UserBookRow;
  buzz: Buzz;
  user_follows: UserFollow;
  book_list: BookListRow;
  book_list_item: BookListItemRow;
  sync_document: SyncDocumentRow;
  personal_book: PersonalBookRow;
  personal_shelf: PersonalShelfRow;
  personal_shelf_item: PersonalShelfItemRow;
  enrich_queue: EnrichQueueRow;
};

/** Pending Goodreads enrichment work — see src/utils/enrichQueue.ts. */
export type EnrichQueueRow = {
  hiveId: HiveId;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: string;
  claimedAt: string | null;
  lastError: string | null;
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
  "user_book.previousReads",
  "hive_book.cover",
  "hive_book.thumbnail",
  "hive_book.description",
  "hive_book.rating",
  "hive_book.ratingsCount",
  "hive_book.rawTitle",
  "hive_book.meta",
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

migrations["011"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").addColumn("hiveBookAtUri", "text").execute();
    await db.schema.alterTable("hive_book").addColumn("hiveBookCatalogUpdatedAt", "text").execute();
    await db.schema.alterTable("hive_book").dropColumn("genres").execute();

    await db.schema
      .alterTable("user_book")
      .addColumn("owned", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
    await sql`UPDATE user_book SET owned = 1, status = NULL WHERE status = 'buzz.bookhive.defs#owned'`.execute(
      db,
    );

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
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("book_list_item").execute();
    await db.schema.dropTable("book_list").execute();
    await db.schema.alterTable("user_book").dropColumn("owned").execute();
    await db.schema.alterTable("hive_book").addColumn("genres", "text").execute();
    await db.schema.alterTable("hive_book").dropColumn("hiveBookCatalogUpdatedAt").execute();
    await db.schema.alterTable("hive_book").dropColumn("hiveBookAtUri").execute();
  },
};

migrations["012"] = {
  async up(db: Kysely<unknown>) {
    // hive_book covering indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_hive_book_ratings_thumbnail
      ON hive_book(ratingsCount DESC, authors, thumbnail)
      WHERE thumbnail IS NOT NULL AND thumbnail != ''`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_hive_book_author_ratings
      ON hive_book(authors, ratingsCount, rating)`.execute(db);

    // user_book query indexes
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

    // book_list indexes
    await db.schema.createIndex("idx_book_list_user").on("book_list").column("userDid").execute();
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

    // hive_book_genre: replace two single-column indexes with composite unique
    await sql`
      DELETE FROM hive_book_genre
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM hive_book_genre GROUP BY hiveId, genre
      )
    `.execute(db);
    await db.schema.dropIndex("idx_hive_book_genre_genre").ifExists().execute();
    await db.schema.dropIndex("idx_hive_book_genre_hive_id").ifExists().execute();
    await sql`CREATE UNIQUE INDEX idx_hive_book_genre_pk ON hive_book_genre(hiveId, genre)`.execute(
      db,
    );

    // buzz indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_buzz_hive_id ON buzz(hiveId, createdAt)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_buzz_parent_uri ON buzz(parentUri)`.execute(db);

    // Drop redundant single-column index: covered by idx_user_follows_primary (userDid, followsDid)
    await db.schema.dropIndex("idx_user_follows_user").ifExists().execute();

    // Covering index for friends feed subquery: WHERE userDid = ? AND isActive = 1 SELECT followsDid
    await db.schema
      .createIndex("idx_user_follows_active")
      .on("user_follows")
      .columns(["userDid", "isActive", "followsDid"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex("idx_user_follows_active").ifExists().execute();
    await db.schema
      .createIndex("idx_user_follows_user")
      .on("user_follows")
      .column("userDid")
      .execute();
    await sql`DROP INDEX IF EXISTS idx_buzz_parent_uri`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_buzz_hive_id`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_hive_book_genre_pk`.execute(db);
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
    await db.schema.dropIndex("idx_book_list_item_hive").ifExists().execute();
    await db.schema.dropIndex("idx_book_list_item_list").ifExists().execute();
    await db.schema.dropIndex("idx_book_list_user").ifExists().execute();
    await db.schema.dropIndex("idx_user_book_user_created").ifExists().execute();
    await db.schema.dropIndex("idx_user_book_hive_id").ifExists().execute();
    await db.schema.dropIndex("idx_user_book_user_did").ifExists().execute();
    await sql`DROP INDEX IF EXISTS idx_hive_book_author_ratings`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_hive_book_ratings_thumbnail`.execute(db);
  },
};

migrations["013"] = {
  async up(db: Kysely<unknown>) {
    // Add top-level language column extracted from meta JSON
    await db.schema.alterTable("hive_book").addColumn("language", "text").execute();

    // Backfill from meta JSON where language is present and non-empty
    await sql`
      UPDATE hive_book
      SET language = json_extract(meta, '$.language')
      WHERE meta IS NOT NULL
        AND json_extract(meta, '$.language') IS NOT NULL
        AND json_extract(meta, '$.language') != ''
    `.execute(db);

    // Index for language filtering
    await sql`CREATE INDEX idx_hive_book_language ON hive_book(language)`.execute(db);

    // Composite index for language + popularity ordering
    await sql`CREATE INDEX idx_hive_book_language_ratings ON hive_book(language, ratingsCount DESC, rating DESC)`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP INDEX IF EXISTS idx_hive_book_language_ratings`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_hive_book_language`.execute(db);
    await db.schema.alterTable("hive_book").dropColumn("language").execute();
  },
};

migrations["014"] = {
  async up(db: Kysely<unknown>) {
    // Migration 012 replaced the single-column genre indexes with the UNIQUE
    // (hiveId, genre) index, which cannot serve `WHERE genre = ?` — genre pages
    // were full-scanning hive_book_genre. Restore a genre-leading index.
    await sql`CREATE INDEX idx_hive_book_genre_genre ON hive_book_genre(genre, hiveId)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP INDEX IF EXISTS idx_hive_book_genre_genre`.execute(db);
  },
};

migrations["015"] = {
  async up(db: Kysely<unknown>) {
    // Re-read history (array of prior reads) stored as JSON, mirroring bookProgress.
    await db.schema.alterTable("user_book").addColumn("previousReads", "text").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("user_book").dropColumn("previousReads").execute();
  },
};

migrations["016"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("sync_document")
      .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("provider", "text", (col) => col.notNull().defaultTo("kosync"))
      .addColumn("documentHash", "text", (col) => col.notNull())
      .addColumn("hiveId", "text")
      .addColumn("filename", "text")
      .addColumn("title", "text")
      .addColumn("authors", "text")
      .addColumn("progressData", "text", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();

    await sql`CREATE UNIQUE INDEX idx_sync_document_user_provider_doc ON sync_document(userDid, provider, documentHash)`.execute(
      db,
    );
    await sql`CREATE INDEX idx_sync_document_user ON sync_document(userDid, provider)`.execute(db);
    await sql`CREATE INDEX idx_sync_document_hive ON sync_document(hiveId)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("sync_document").execute();
  },
};

migrations["017"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("personal_book")
      .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("contentHash", "text", (col) => col.notNull())
      .addColumn("hiveId", "text")
      .addColumn("filename", "text", (col) => col.notNull())
      .addColumn("title", "text", (col) => col.notNull())
      .addColumn("authors", "text")
      .addColumn("language", "text")
      .addColumn("format", "text", (col) => col.notNull())
      .addColumn("mime", "text", (col) => col.notNull())
      .addColumn("filePath", "text", (col) => col.notNull())
      .addColumn("coverPath", "text")
      .addColumn("coverMime", "text")
      .addColumn("sizeBytes", "integer", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();

    await sql`CREATE UNIQUE INDEX idx_personal_book_user_hash ON personal_book(userDid, contentHash)`.execute(
      db,
    );
    await sql`CREATE INDEX idx_personal_book_user ON personal_book(userDid)`.execute(db);
    await sql`CREATE INDEX idx_personal_book_hive ON personal_book(hiveId)`.execute(db);

    await db.schema
      .createTable("personal_shelf")
      .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("userDid", "text", (col) => col.notNull())
      .addColumn("name", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("createdAt", "text", (col) => col.notNull())
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .execute();

    await sql`CREATE UNIQUE INDEX idx_personal_shelf_user_name ON personal_shelf(userDid, name)`.execute(
      db,
    );

    await db.schema
      .createTable("personal_shelf_item")
      .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
      .addColumn("shelfId", "integer", (col) => col.notNull())
      .addColumn("personalBookId", "integer", (col) => col.notNull())
      .addColumn("createdAt", "text", (col) => col.notNull())
      .execute();

    await sql`CREATE UNIQUE INDEX idx_personal_shelf_item_pk ON personal_shelf_item(shelfId, personalBookId)`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("personal_shelf_item").execute();
    await db.schema.dropTable("personal_shelf").execute();
    await db.schema.dropTable("personal_book").execute();
  },
};

// Work queue for Goodreads enrichment. Any process can enqueue (a cheap
// INSERT OR IGNORE); only the primary worker drains it, so there is one WAF
// token cache and one writer instead of an unbounded per-request fan-out
// across all cluster processes. See src/utils/enrichQueue.ts.
migrations["018"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("enrich_queue")
      // hiveId as the PK is the dedupe: re-enqueueing a queued book is a no-op.
      .addColumn("hiveId", "text", (col) => col.primaryKey())
      .addColumn("enqueuedAt", "text", (col) => col.notNull())
      .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
      .addColumn("nextAttemptAt", "text", (col) => col.notNull())
      .addColumn("claimedAt", "text")
      .addColumn("lastError", "text")
      .execute();

    await sql`CREATE INDEX idx_enrich_queue_ready ON enrich_queue(claimedAt, nextAttemptAt)`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("enrich_queue").execute();
  },
};

/**
 * Full-text index over the columns search and the author pages filter on.
 *
 * Those queries were `LIKE '%…%'`, which no index can serve: both planned
 * `SCAN hive_book` + `USE TEMP B-TREE FOR ORDER BY` over 356k rows. Measured on
 * production: 633–725ms each, on routes that are ~82% of all traffic
 * (/og 705, /books 704, /authors 460 in a 3h sample), and `refetchBooks` used
 * to fire 100 of them concurrently.
 *
 * External-content FTS5, so the text is not duplicated — the index is ~36 MB
 * against a 1.6 GB database and backfills in ~2.7s, well inside the
 * supervisor's healthcheck barrier. Queries drop to 0–7ms.
 *
 * `unicode61` rather than `trigram`: trigram would preserve `LIKE`'s exact
 * substring semantics but costs 210 MB and 10.5s. Compared against LIKE on
 * production data with phrase queries (see `ftsMatchQuery`), unicode61 returns
 * identical top-20 results for realistic searches, and the cases where it
 * differs are ones where it is better — `stephen king` returns actual King
 * novels instead of junk whose *title* contains "by Stephen King", and
 * `the "great" gatsby` returns The Great Gatsby where LIKE returned nothing.
 */
migrations["019"] = {
  async up(db: Kysely<unknown>) {
    await sql`
      CREATE VIRTUAL TABLE hive_book_fts USING fts5(
        title,
        rawTitle,
        authors,
        content='hive_book',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      )
    `.execute(db);

    await sql`
      INSERT INTO hive_book_fts(rowid, title, rawTitle, authors)
      SELECT rowid, title, rawTitle, authors FROM hive_book
    `.execute(db);

    // External-content tables need the source table's writes mirrored by hand.
    // The 'delete' command replays the *old* row so its terms are removed;
    // getting this wrong leaves orphaned terms that match forever.
    await sql`
      CREATE TRIGGER hive_book_fts_ai AFTER INSERT ON hive_book BEGIN
        INSERT INTO hive_book_fts(rowid, title, rawTitle, authors)
        VALUES (new.rowid, new.title, new.rawTitle, new.authors);
      END
    `.execute(db);

    await sql`
      CREATE TRIGGER hive_book_fts_ad AFTER DELETE ON hive_book BEGIN
        INSERT INTO hive_book_fts(hive_book_fts, rowid, title, rawTitle, authors)
        VALUES ('delete', old.rowid, old.title, old.rawTitle, old.authors);
      END
    `.execute(db);

    await sql`
      CREATE TRIGGER hive_book_fts_au AFTER UPDATE ON hive_book BEGIN
        INSERT INTO hive_book_fts(hive_book_fts, rowid, title, rawTitle, authors)
        VALUES ('delete', old.rowid, old.title, old.rawTitle, old.authors);
        INSERT INTO hive_book_fts(rowid, title, rawTitle, authors)
        VALUES (new.rowid, new.title, new.rawTitle, new.authors);
      END
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP TRIGGER IF EXISTS hive_book_fts_au`.execute(db);
    await sql`DROP TRIGGER IF EXISTS hive_book_fts_ad`.execute(db);
    await sql`DROP TRIGGER IF EXISTS hive_book_fts_ai`.execute(db);
    await sql`DROP TABLE IF EXISTS hive_book_fts`.execute(db);
  },
};

/**
 * Authors normalized out of the tab-separated `hive_book.authors` column, the
 * same shape `hive_book_genre` already uses for genres (migration 011).
 *
 * `authors` stores "Author1\tAuthor2\tAuthor3", so "books by this author" was
 * four LIKE patterns per query (`buildAuthorLikePatterns`) covering the sole /
 * first / middle / last positions. Two of those are leading-wildcard, so no
 * index could ever serve them: `/authors/:author` planned `SCAN hive_book` +
 * a temp B-tree sort over 356k rows at ~511ms, on ~460 requests per 3h, and
 * the author directory had to `GROUP BY` a `CASE/instr/substr/trim` expression
 * to recover the first author.
 *
 * Deliberately not FTS5: this is an exact-identity lookup, not a text search.
 * Matching "Stephen King" must not also return "Stephen Kingsley".
 *
 * Maintained by triggers rather than an application helper (the way
 * `syncHiveBookGenres` is) because `hive_book.authors` is written from the
 * ingester, the importer, enrichment and the catalog service — a helper only
 * has to be forgotten at one call site to silently desynchronize the table.
 */
/**
 * Recursive split of a tab-separated author string into (part, pos) rows.
 * `source` is the SQL expression holding the string — inside a trigger body
 * that has to be `new.authors`; a bare `authors` is not in scope there.
 */
const splitAuthorsCte = (source: string) =>
  sql.raw(`
  WITH RECURSIVE split(rest, part, pos) AS (
    SELECT ${source} || char(9), NULL, -1
    UNION ALL
    SELECT substr(rest, instr(rest, char(9)) + 1),
           trim(substr(rest, 1, instr(rest, char(9)) - 1)),
           pos + 1
    FROM split WHERE rest <> ''
  )
`);

migrations["020"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("hive_book_author")
      .addColumn("hiveId", "text", (col) => col.notNull())
      .addColumn("author", "text", (col) => col.notNull())
      // 0 = the credited first author, which is what the directory groups by.
      .addColumn("position", "integer", (col) => col.notNull())
      .addPrimaryKeyConstraint("hive_book_author_pk", ["hiveId", "author"])
      .execute();

    await sql`CREATE INDEX idx_hive_book_author_author ON hive_book_author(author)`.execute(db);
    await sql`CREATE INDEX idx_hive_book_author_first ON hive_book_author(position, author)`.execute(
      db,
    );

    await sql`
      INSERT OR IGNORE INTO hive_book_author(hiveId, author, position)
      SELECT b.id, s.part, s.pos
      FROM hive_book b
      JOIN (
        WITH RECURSIVE split(id, rest, part, pos) AS (
          SELECT id, authors || char(9), NULL, -1 FROM hive_book
          UNION ALL
          SELECT id,
                 substr(rest, instr(rest, char(9)) + 1),
                 trim(substr(rest, 1, instr(rest, char(9)) - 1)),
                 pos + 1
          FROM split WHERE rest <> ''
        )
        SELECT id, part, pos FROM split WHERE part IS NOT NULL AND part <> ''
      ) s ON s.id = b.id
    `.execute(db);

    await sql`
      CREATE TRIGGER hive_book_author_ai AFTER INSERT ON hive_book BEGIN
        INSERT OR IGNORE INTO hive_book_author(hiveId, author, position)
        ${splitAuthorsCte("new.authors")}
        SELECT new.id, part, pos FROM split WHERE part IS NOT NULL AND part <> '';
      END
    `.execute(db);

    await sql`
      CREATE TRIGGER hive_book_author_ad AFTER DELETE ON hive_book BEGIN
        DELETE FROM hive_book_author WHERE hiveId = old.id;
      END
    `.execute(db);

    // `WHEN old.authors IS NOT new.authors` rather than `AFTER UPDATE OF
    // authors`: the latter fires whenever the column appears in a SET clause
    // even if the value is unchanged, and enrichment rewrites whole rows often.
    await sql`
      CREATE TRIGGER hive_book_author_au AFTER UPDATE ON hive_book
      WHEN old.authors IS NOT new.authors BEGIN
        DELETE FROM hive_book_author WHERE hiveId = old.id;
        INSERT OR IGNORE INTO hive_book_author(hiveId, author, position)
        ${splitAuthorsCte("new.authors")}
        SELECT new.id, part, pos FROM split WHERE part IS NOT NULL AND part <> '';
      END
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP TRIGGER IF EXISTS hive_book_author_au`.execute(db);
    await sql`DROP TRIGGER IF EXISTS hive_book_author_ad`.execute(db);
    await sql`DROP TRIGGER IF EXISTS hive_book_author_ai`.execute(db);
    await db.schema.dropTable("hive_book_author").execute();
  },
};

/**
 * Durable record of enrichment failure, on the book rather than the queue.
 *
 * `enrich_queue` could not converge. A row that exhausted its attempts was
 * deleted (`enrichQueue.ts`) without recording anything on `hive_book`, and
 * `enrichedAt` is only ever set on success — so the very next page view hit
 * `!book.enrichedAt` and re-enqueued it. With a crawler systematically walking
 * all 356k books, that is a perpetual-motion machine: the queue sat at 12,444
 * rows growing ~20/min, and the drainer stayed at full concurrency forever
 * scraping books that had already failed four times.
 *
 * `enrichAttempts` is cumulative across queue rows, so the count survives the
 * row being deleted and re-added. `enrichFailedAt` is a cooldown stamp rather
 * than a permanent tombstone — a book that failed while Goodreads' WAF was up
 * should become eligible again later, just not on the next page view.
 */
migrations["021"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("hive_book")
      .addColumn("enrichAttempts", "integer", (col) => col.notNull().defaultTo(0))
      .execute();
    await db.schema.alterTable("hive_book").addColumn("enrichFailedAt", "text").execute();

    // Books already past the attempt ceiling are in the loop right now; stamp
    // them so the queue can actually drain instead of immediately refilling.
    await sql`
      UPDATE hive_book
      SET enrichAttempts = (
            SELECT attempts FROM enrich_queue q WHERE q.hiveId = hive_book.id
          ),
          enrichFailedAt = datetime('now')
      WHERE id IN (SELECT hiveId FROM enrich_queue WHERE attempts >= 4)
    `.execute(db);

    await sql`DELETE FROM enrich_queue WHERE attempts >= 4`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("hive_book").dropColumn("enrichFailedAt").execute();
    await db.schema.alterTable("hive_book").dropColumn("enrichAttempts").execute();
  },
};

migrations["022"] = {
  async up(db: Kysely<unknown>) {
    // Filename-derived identity for e-reader documents. See
    // src/utils/filenameMatching.ts for what each value is and why the first is
    // exact while the second is not:
    //
    // - `filenameHash` is md5(basename) — literally the `document` id a KOSync
    //   client sends when its checksum method is FILENAME instead of BINARY.
    //   Without it, every user on that setting has a library where no uploaded
    //   file ever lines up with its synced progress, because the id they send
    //   is not a content hash at all.
    // - `filenameKey` is a normalized, extension-less name, so a file survives
    //   the calibre conversion (.epub -> .azw3) that broke the content hash in
    //   the first place — which is the reason those users switched.
    await db.schema.alterTable("personal_book").addColumn("filenameHash", "text").execute();
    await db.schema.alterTable("personal_book").addColumn("filenameKey", "text").execute();
    await db.schema.alterTable("sync_document").addColumn("filenameKey", "text").execute();

    await sql`CREATE INDEX idx_personal_book_user_filename_hash ON personal_book(userDid, filenameHash)`.execute(
      db,
    );
    await sql`CREATE INDEX idx_personal_book_user_filename_key ON personal_book(userDid, filenameKey)`.execute(
      db,
    );
    await sql`CREATE INDEX idx_sync_document_user_filename_key ON sync_document(userDid, filenameKey)`.execute(
      db,
    );

    // Backfill in JS: SQLite has no md5, and the normalization is Unicode-aware.
    // Both tables hold one row per user per book, so this is small.
    //
    // These call the live helpers on purpose — see the header of
    // `utils/filenameMatching.ts`. Changing their output requires a *new*
    // migration that recomputes both columns; pinning a frozen copy here would
    // only guarantee that a fresh install disagrees with the running app.
    const books = (
      await sql<{
        id: number;
        filename: string | null;
      }>`SELECT id, filename FROM personal_book`.execute(db)
    ).rows;
    for (const row of books) {
      const hash = koreaderFilenameHash(row.filename);
      const key = filenameKey(row.filename);
      if (!hash && !key) continue;
      await sql`UPDATE personal_book SET filenameHash = ${hash}, filenameKey = ${key} WHERE id = ${row.id}`.execute(
        db,
      );
    }

    const docs = (
      await sql<{
        id: number;
        filename: string | null;
      }>`SELECT id, filename FROM sync_document WHERE filename IS NOT NULL`.execute(db)
    ).rows;
    for (const row of docs) {
      const key = filenameKey(row.filename);
      if (!key) continue;
      await sql`UPDATE sync_document SET filenameKey = ${key} WHERE id = ${row.id}`.execute(db);
    }
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP INDEX IF EXISTS idx_sync_document_user_filename_key`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_personal_book_user_filename_key`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_personal_book_user_filename_hash`.execute(db);
    await db.schema.alterTable("sync_document").dropColumn("filenameKey").execute();
    await db.schema.alterTable("personal_book").dropColumn("filenameKey").execute();
    await db.schema.alterTable("personal_book").dropColumn("filenameHash").execute();
  },
};

migrations["023"] = {
  async up(db: Kysely<unknown>) {
    // Covering index for the storage quota. The quota is enforced as
    // `SUM(sizeBytes) WHERE userDid = ?` evaluated inside the upload INSERT, and
    // the existing `idx_personal_book_user` only covers `userDid` — SQLite would
    // walk it and then fetch every row from the table to read `sizeBytes`. With
    // the size in the index the SUM is an index-only range scan.
    await sql`CREATE INDEX idx_personal_book_user_size ON personal_book(userDid, sizeBytes)`.execute(
      db,
    );

    // `parseBook` returns `authors: ""` (not null) on every fallback path, and
    // the web upload route stored that verbatim while the XRPC one normalised
    // it. The two are indistinguishable to JS truthiness and completely
    // different to SQL — `WHERE authors IS NULL` silently misses every row the
    // web route wrote. Normalise the existing rows once here; the shared upload
    // core writes NULL from now on.
    await sql`UPDATE personal_book SET authors = NULL WHERE authors = ''`.execute(db);
    await sql`UPDATE personal_book SET language = NULL WHERE language = ''`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`DROP INDEX IF EXISTS idx_personal_book_user_size`.execute(db);
  },
};

// APIs

export const createDb = (location: string): { db: Database; sqlite: DatabaseSync } => {
  const sqlite = new DatabaseSync(location);
  // 10s: four cluster processes write to this one file (see server/cluster.ts).
  sqlite.exec("PRAGMA busy_timeout = 10000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL"); // safe with WAL; skips redundant fsyncs
  // Private page cache is per connection and multiplies across worker processes
  // — keep it small.
  sqlite.exec(`PRAGMA cache_size = -${env.DB_CACHE_KB}`); // default 16 MB
  sqlite.exec("PRAGMA temp_store = MEMORY"); // temp B-trees (sorts, GROUP BY) in RAM
  // Default 0 (off). See DB_MMAP_SIZE in src/env.ts for the measurements —
  // mapping a 1.6 GB database into every worker cost ~1 GB of the cgroup's
  // budget and caused the reclaim thrash behind the 2026-08 stalls.
  sqlite.exec(`PRAGMA mmap_size = ${env.DB_MMAP_SIZE}`);

  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });

  return { db, sqlite };
};

export const migrateToLatest = async (db: Database, sqlite?: DatabaseSync) => {
  // Temporarily disable fsyncs during migrations for speed. Safe because if we crash
  // mid-migration, Kysely won't record it as complete and it re-runs on next startup.
  if (sqlite) sqlite.exec("PRAGMA synchronous = OFF");
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error, results } = await migrator.migrateToLatest();
  if (sqlite) sqlite.exec("PRAGMA synchronous = NORMAL");
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
