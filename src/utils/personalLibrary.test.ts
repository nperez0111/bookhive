import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { rm } from "node:fs/promises";
import path from "node:path";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { streamPersonalBook } from "./personalLibrary";

const DID = "did:plc:testuser";
const HASH = "abc123";
const now = "2026-08-02T12:00:00.000Z";

let db: Database;
let filePath: string;

beforeEach(async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);

  filePath = path.join("/tmp", `personal-library-test-${HASH}.epub`);
  await Bun.write(filePath, "epub bytes");

  await db
    .insertInto("personal_book")
    .values({
      userDid: DID,
      contentHash: HASH,
      hiveId: null,
      filename: "book.epub",
      title: "A Personal Book",
      authors: "An Author",
      language: "en",
      format: "epub",
      mime: "application/epub+zip",
      filePath,
      coverPath: null,
      coverMime: null,
      sizeBytes: 10,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
});

afterEach(async () => {
  await db.destroy();
  await rm(filePath, { force: true });
});

describe("streamPersonalBook", () => {
  it("streams the file with a strong ETag when there is no validator", async () => {
    const result = await streamPersonalBook(db, DID, HASH);
    expect(result).not.toBeNull();
    expect(result!.notModified).toBe(false);
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
    expect(result!.headers["Content-Type"]).toBe("application/epub+zip");
  });

  // The regression: these routes are excluded from hono's etag() middleware
  // because it buffers the whole body through a digest. That middleware was
  // also what turned If-None-Match into a 304 — setting the header alone does
  // not, so without this branch an e-reader re-downloads every book on every
  // sync.
  it("returns notModified when If-None-Match matches the content hash", async () => {
    const result = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(result).not.toBeNull();
    expect(result!.notModified).toBe(true);
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
    expect(result).not.toHaveProperty("stream");
  });

  it("handles the weak prefix, comma lists and wildcard clients send", async () => {
    for (const header of [`W/"${HASH}"`, `"other", "${HASH}"`, "*"]) {
      const result = await streamPersonalBook(db, DID, HASH, header);
      expect(result!.notModified).toBe(true);
    }
  });

  it("still streams when the validator is for a different version", async () => {
    const result = await streamPersonalBook(db, DID, HASH, `"stale-hash"`);
    expect(result!.notModified).toBe(false);
  });

  it("answers the conditional request without touching the file", async () => {
    // A 304 must not depend on the file still being readable — otherwise a
    // missing file turns a cheap revalidation into a 404 for a book the client
    // already has.
    await rm(filePath, { force: true });
    const result = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(result!.notModified).toBe(true);
  });

  it("returns null for another user's book", async () => {
    expect(await streamPersonalBook(db, "did:plc:someoneelse", HASH)).toBeNull();
  });
});
