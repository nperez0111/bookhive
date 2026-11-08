-- Frozen upgrade baseline generated from origin/main b1b55b8:src/db.ts.
-- Generation: load that exact file as a temporary sibling module of src/db.ts;
-- call its createDb(':memory:') and migrateToLatest(db, sqlite), then export
-- sqlite_schema SQL (excluding SQLite internals and FTS shadow tables, NOT triggers) and
-- kysely_migration / kysely_migration_lock rows. Do not regenerate from current db.ts.
-- User data is inserted by syncWriteUpgrade.test.ts before running current migrations.
CREATE TABLE "kysely_migration" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null);
CREATE TABLE "kysely_migration_lock" ("id" varchar(255) not null primary key, "is_locked" integer default 0 not null);
CREATE TABLE "user_book" ("uri" text primary key, "cid" text not null, "userDid" text not null, "createdAt" text not null, "indexedAt" text not null, "hiveId" text not null, "title" text not null, "authors" text not null, "status" text, "startedAt" text, "finishedAt" text, "stars" int8, "review" text, "bookProgress" text, "owned" integer default 0 not null, "previousReads" text, "record" text);
CREATE TABLE "hive_book" ("id" text primary key, "title" text not null, "authors" text not null, "source" text not null, "sourceUrl" text, "sourceId" text, "cover" text, "thumbnail" text not null, "description" text, "rating" real, "ratingsCount" integer, "createdAt" text not null, "updatedAt" text not null, "rawTitle" text, "series" text, "meta" text, "enrichedAt" text, "identifiers" text, "hiveBookAtUri" text, "hiveBookCatalogUpdatedAt" text, "language" text, "enrichAttempts" integer default 0 not null, "enrichFailedAt" text);
CREATE TABLE "buzz" ("uri" text primary key, "cid" text not null, "userDid" text not null, "createdAt" text not null, "indexedAt" text not null, "comment" text not null, "bookUri" text not null, "bookCid" text not null, "hiveId" text not null, "parentUri" text not null, "parentCid" text not null);
CREATE TABLE "user_follows" ("userDid" text not null, "followsDid" text not null, "followedAt" text not null, "syncedAt" text not null, "lastSeenAt" text not null, "isActive" integer default 1 not null);
CREATE UNIQUE INDEX "idx_user_follows_primary" on "user_follows" ("userDid", "followsDid");
CREATE INDEX "idx_user_follows_synced" on "user_follows" ("userDid", "syncedAt");
CREATE TABLE "book_id_map" ("hiveId" text primary key, "isbn" text, "isbn13" text, "goodreadsId" text, "updatedAt" text not null);
CREATE INDEX "idx_book_id_map_isbn" on "book_id_map" ("isbn");
CREATE INDEX "idx_book_id_map_isbn13" on "book_id_map" ("isbn13");
CREATE INDEX "idx_book_id_map_goodreads_id" on "book_id_map" ("goodreadsId");
CREATE INDEX "idx_user_book_created_at" on "user_book" ("createdAt");
CREATE TABLE "hive_book_genre" ("hiveId" text not null, "genre" text not null);
CREATE TABLE "book_list" ("uri" text primary key, "cid" text not null, "userDid" text not null, "name" text not null, "description" text, "ordered" integer default 0 not null, "tags" text, "createdAt" text not null, "indexedAt" text not null, itemOrder TEXT);
CREATE TABLE "book_list_item" ("uri" text primary key, "cid" text not null, "userDid" text not null, "listUri" text not null, "hiveId" text, "description" text, "position" integer, "addedAt" text not null, "indexedAt" text not null, "embeddedTitle" text, "embeddedAuthor" text, "embeddedCoverUrl" text, "identifiers" text);
CREATE INDEX idx_hive_book_ratings_thumbnail
      ON hive_book(ratingsCount DESC, authors, thumbnail)
      WHERE thumbnail IS NOT NULL AND thumbnail != '';
CREATE INDEX idx_hive_book_author_ratings
      ON hive_book(authors, ratingsCount, rating);
CREATE INDEX "idx_user_book_user_did" on "user_book" ("userDid");
CREATE INDEX "idx_user_book_user_created" on "user_book" ("userDid", "createdAt");
CREATE INDEX "idx_book_list_user" on "book_list" ("userDid");
CREATE INDEX "idx_book_list_item_list" on "book_list_item" ("listUri");
CREATE INDEX "idx_book_list_item_hive" on "book_list_item" ("hiveId");
CREATE UNIQUE INDEX idx_hive_book_genre_pk ON hive_book_genre(hiveId, genre);
CREATE INDEX idx_buzz_hive_id ON buzz(hiveId, createdAt);
CREATE INDEX idx_buzz_parent_uri ON buzz(parentUri);
CREATE INDEX "idx_user_follows_active" on "user_follows" ("userDid", "isActive", "followsDid");
CREATE INDEX idx_hive_book_language ON hive_book(language);
CREATE INDEX idx_hive_book_language_ratings ON hive_book(language, ratingsCount DESC, rating DESC);
CREATE INDEX idx_hive_book_genre_genre ON hive_book_genre(genre, hiveId);
CREATE TABLE "sync_document" ("id" integer primary key autoincrement, "userDid" text not null, "provider" text default 'kosync' not null, "documentHash" text not null, "hiveId" text, "filename" text, "title" text, "authors" text, "progressData" text not null, "createdAt" text not null, "updatedAt" text not null, "filenameKey" text);
CREATE UNIQUE INDEX idx_sync_document_user_provider_doc ON sync_document(userDid, provider, documentHash);
CREATE INDEX idx_sync_document_user ON sync_document(userDid, provider);
CREATE INDEX idx_sync_document_hive ON sync_document(hiveId);
CREATE TABLE "personal_book" ("id" integer primary key autoincrement, "userDid" text not null, "contentHash" text not null, "hiveId" text, "filename" text not null, "title" text not null, "authors" text, "language" text, "format" text not null, "mime" text not null, "filePath" text not null, "coverPath" text, "coverMime" text, "sizeBytes" integer not null, "createdAt" text not null, "updatedAt" text not null, "filenameHash" text, "filenameKey" text, "epubPath" text, "epubSizeBytes" integer);
CREATE UNIQUE INDEX idx_personal_book_user_hash ON personal_book(userDid, contentHash);
CREATE INDEX idx_personal_book_user ON personal_book(userDid);
CREATE INDEX idx_personal_book_hive ON personal_book(hiveId);
CREATE TABLE "personal_shelf" ("id" integer primary key autoincrement, "userDid" text not null, "name" text not null, "description" text, "createdAt" text not null, "updatedAt" text not null);
CREATE UNIQUE INDEX idx_personal_shelf_user_name ON personal_shelf(userDid, name);
CREATE TABLE "personal_shelf_item" ("id" integer primary key autoincrement, "shelfId" integer not null, "personalBookId" integer not null, "createdAt" text not null);
CREATE UNIQUE INDEX idx_personal_shelf_item_pk ON personal_shelf_item(shelfId, personalBookId);
CREATE TABLE "enrich_queue" ("hiveId" text primary key, "enqueuedAt" text not null, "attempts" integer default 0 not null, "nextAttemptAt" text not null, "claimedAt" text, "lastError" text);
CREATE INDEX idx_enrich_queue_ready ON enrich_queue(claimedAt, nextAttemptAt);
CREATE VIRTUAL TABLE hive_book_fts USING fts5(
        title,
        rawTitle,
        authors,
        content='hive_book',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
CREATE TRIGGER hive_book_fts_ai AFTER INSERT ON hive_book BEGIN
        INSERT INTO hive_book_fts(rowid, title, rawTitle, authors)
        VALUES (new.rowid, new.title, new.rawTitle, new.authors);
      END;
CREATE TRIGGER hive_book_fts_ad AFTER DELETE ON hive_book BEGIN
        INSERT INTO hive_book_fts(hive_book_fts, rowid, title, rawTitle, authors)
        VALUES ('delete', old.rowid, old.title, old.rawTitle, old.authors);
      END;
CREATE TRIGGER hive_book_fts_au AFTER UPDATE ON hive_book BEGIN
        INSERT INTO hive_book_fts(hive_book_fts, rowid, title, rawTitle, authors)
        VALUES ('delete', old.rowid, old.title, old.rawTitle, old.authors);
        INSERT INTO hive_book_fts(rowid, title, rawTitle, authors)
        VALUES (new.rowid, new.title, new.rawTitle, new.authors);
      END;
CREATE TABLE "hive_book_author" ("hiveId" text not null, "author" text not null, "position" integer not null, constraint "hive_book_author_pk" primary key ("hiveId", "author"));
CREATE INDEX idx_hive_book_author_author ON hive_book_author(author);
CREATE TRIGGER hive_book_author_ai AFTER INSERT ON hive_book BEGIN
        INSERT OR IGNORE INTO hive_book_author(hiveId, author, position)

  WITH RECURSIVE split(rest, part, pos) AS (
    SELECT new.authors || char(9), NULL, -1
    UNION ALL
    SELECT substr(rest, instr(rest, char(9)) + 1),
           trim(substr(rest, 1, instr(rest, char(9)) - 1)),
           pos + 1
    FROM split WHERE rest <> ''
  )

        SELECT new.id, part, pos FROM split WHERE part IS NOT NULL AND part <> '';
      END;
CREATE TRIGGER hive_book_author_ad AFTER DELETE ON hive_book BEGIN
        DELETE FROM hive_book_author WHERE hiveId = old.id;
      END;
CREATE TRIGGER hive_book_author_au AFTER UPDATE ON hive_book
      WHEN old.authors IS NOT new.authors BEGIN
        DELETE FROM hive_book_author WHERE hiveId = old.id;
        INSERT OR IGNORE INTO hive_book_author(hiveId, author, position)

  WITH RECURSIVE split(rest, part, pos) AS (
    SELECT new.authors || char(9), NULL, -1
    UNION ALL
    SELECT substr(rest, instr(rest, char(9)) + 1),
           trim(substr(rest, 1, instr(rest, char(9)) - 1)),
           pos + 1
    FROM split WHERE rest <> ''
  )

        SELECT new.id, part, pos FROM split WHERE part IS NOT NULL AND part <> '';
      END;
CREATE INDEX idx_personal_book_user_filename_hash ON personal_book(userDid, filenameHash);
CREATE INDEX idx_personal_book_user_filename_key ON personal_book(userDid, filenameKey);
CREATE INDEX idx_sync_document_user_filename_key ON sync_document(userDid, filenameKey);
CREATE INDEX idx_personal_book_user_size ON personal_book(userDid, sizeBytes);
CREATE INDEX idx_hive_book_stats ON hive_book(id, ratingsCount, rating, language);
CREATE INDEX idx_hive_book_author_first_cover ON hive_book_author(position, author, hiveId);
CREATE INDEX idx_user_book_feed ON user_book(indexedAt, uri);
CREATE INDEX idx_user_book_user_feed ON user_book(userDid, indexedAt, uri);
CREATE INDEX idx_user_book_hive_feed ON user_book(hiveId, indexedAt, uri);
CREATE TABLE progress_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userDid TEXT NOT NULL,
      hiveId TEXT NOT NULL,
      currentPage INTEGER,
      totalPages INTEGER,
      percent INTEGER,
      createdAt TEXT NOT NULL
    );
CREATE INDEX idx_progress_history_user_book
      ON progress_history(userDid, hiveId, createdAt DESC);
CREATE INDEX idx_progress_history_user_recent
      ON progress_history(userDid, createdAt DESC);
CREATE INDEX idx_hive_book_enrich_failed_at
      ON hive_book(enrichFailedAt) WHERE enrichFailedAt IS NOT NULL;
CREATE INDEX idx_hive_book_search_rank
      ON hive_book(ratingsCount DESC, rating DESC, id ASC);
CREATE INDEX idx_user_follows_reverse_active
      ON user_follows(followsDid, isActive, followedAt DESC, userDid DESC);
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('001', '2026-11-08T22:25:20.697Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('002', '2026-11-08T22:25:20.697Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('003', '2026-11-08T22:25:20.698Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('004', '2026-11-08T22:25:20.698Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('005', '2026-11-08T22:25:20.698Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('006', '2026-11-08T22:25:20.698Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('007', '2026-11-08T22:25:20.699Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('008', '2026-11-08T22:25:20.699Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('009', '2026-11-08T22:25:20.699Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('010', '2026-11-08T22:25:20.699Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('011', '2026-11-08T22:25:20.700Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('012', '2026-11-08T22:25:20.701Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('013', '2026-11-08T22:25:20.701Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('014', '2026-11-08T22:25:20.701Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('015', '2026-11-08T22:25:20.701Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('016', '2026-11-08T22:25:20.701Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('017', '2026-11-08T22:25:20.702Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('018', '2026-11-08T22:25:20.702Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('019', '2026-11-08T22:25:20.702Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('020', '2026-11-08T22:25:20.703Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('021', '2026-11-08T22:25:20.703Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('022', '2026-11-08T22:25:20.704Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('023', '2026-11-08T22:25:20.704Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('024', '2026-11-08T22:25:20.704Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('025', '2026-11-08T22:25:20.705Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('026', '2026-11-08T22:25:20.705Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('027', '2026-11-08T22:25:20.705Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('028', '2026-11-08T22:25:20.705Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('029', '2026-11-08T22:25:20.706Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('030', '2026-11-08T22:25:20.706Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('031', '2026-11-08T22:25:20.706Z');
INSERT INTO kysely_migration ("name", "timestamp") VALUES ('032', '2026-11-08T22:25:20.706Z');
INSERT INTO kysely_migration_lock ("id", "is_locked") VALUES ('migration_lock', 0);
