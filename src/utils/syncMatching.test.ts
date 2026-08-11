import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { getHiveId } from "../scrapers/getHiveId";
import type { HiveId } from "../types";
import { filenameKey, koreaderFilenameHash } from "./filenameMatching";
import { matchSyncDocument, matchSyncDocumentForUser } from "./syncMatching";

const DID = "did:plc:testuser";

/** Hand-built like the other DB suites; `createDb` reads a mocked `env`. */
async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

describe("matchSyncDocument", () => {
  let db: Database;

  const insert = async (title: string, authors: string, ratingsCount = 0): Promise<HiveId> => {
    const id = getHiveId({ title, authors });
    await db
      .insertInto("hive_book")
      .values({
        id: id as never,
        title,
        rawTitle: title,
        authors,
        ratingsCount,
        source: "goodreads",
        thumbnail: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
      .execute();
    return id;
  };

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("tier 1 — exact hash of the client's metadata", () => {
    it("matches title + authors", async () => {
      const id = await insert("The Dispossessed", "Ursula K. Le Guin");
      expect(
        await matchSyncDocument(db, { title: "The Dispossessed", authors: "Ursula K. Le Guin" }),
      ).toBe(id);
    });

    it("returns null when nothing identifies the document", async () => {
      await insert("The Dispossessed", "Ursula K. Le Guin");
      expect(await matchSyncDocument(db, {})).toBeNull();
    });

    it("splits newline-separated authors, which is how KOReader sends them", async () => {
      // `metadata.authors` is `doc_props.authors`, one of the props KOReader
      // edits with `allow_newline = true`. Treated as one name it matches
      // nobody.
      const id = await insert("Good Omens", "Terry Pratchett", 900);
      expect(
        await matchSyncDocument(db, {
          title: "Good Omens",
          authors: "Neil Gaiman\nTerry Pratchett",
          filename: "Good Omens.epub",
        }),
      ).toBe(id);
    });
  });

  describe("tier 2 — exact hash of filename-derived pairs", () => {
    it("matches a document that carries only a filename", async () => {
      // The case this whole path exists for: KOSync metadata is optional, and
      // a client that sends just the filename used to be unmatchable.
      const id = await insert("The Dispossessed", "Ursula K. Le Guin");
      expect(
        await matchSyncDocument(db, {
          filename: "Ursula K. Le Guin - The Dispossessed.epub",
        }),
      ).toBe(id);
    });

    it("matches regardless of which side of the dash the author is on", async () => {
      const id = await insert("The Dispossessed", "Ursula K. Le Guin");
      expect(
        await matchSyncDocument(db, { filename: "The Dispossessed - Ursula K. Le Guin.epub" }),
      ).toBe(id);
    });

    it("crosses a client title with a filename author", async () => {
      const id = await insert("Dune", "Frank Herbert");
      expect(
        await matchSyncDocument(db, { title: "Dune", filename: "Frank Herbert - Dune.epub" }),
      ).toBe(id);
    });

    it("parses the client's title, which KOReader derives from the filename", async () => {
      // `display_title` is `props.title or splitFileNameType(filepath)`, so a
      // document with no embedded title sends the filename stem as its title.
      const id = await insert("The Dispossessed", "Ursula K. Le Guin");
      expect(await matchSyncDocument(db, { title: "Ursula K. Le Guin - The Dispossessed" })).toBe(
        id,
      );
    });

    it("prefers the client's own metadata over a filename guess", async () => {
      const real = await insert("Dune", "Frank Herbert");
      await insert("Dune", "Someone Else");
      expect(
        await matchSyncDocument(db, {
          title: "Dune",
          authors: "Frank Herbert",
          filename: "Someone Else - Dune.epub",
        }),
      ).toBe(real);
    });
  });

  describe("tier 3 — fuzzy, filename only", () => {
    it("matches a title the id hash could not, when the author agrees", async () => {
      // The filename title is exact but the author is written differently, so
      // the title+author hash misses entirely.
      const id = await insert("The Dispossessed", "Ursula K. Le Guin", 100);
      expect(
        await matchSyncDocument(db, { filename: "Le Guin, Ursula - The Dispossessed.epub" }),
      ).toBe(id);
    });

    it("accepts an unambiguous title with no author anywhere", async () => {
      const id = await insert("The Dispossessed", "Ursula K. Le Guin", 100);
      expect(await matchSyncDocument(db, { filename: "The Dispossessed.epub" })).toBe(id);
    });

    it("refuses to pick between books that share a title", async () => {
      // Ranking is by popularity, which says nothing about which one this is.
      await insert("Dune", "Frank Herbert", 900);
      await insert("Dune", "A Different Author", 5);
      expect(await matchSyncDocument(db, { filename: "Dune.epub" })).toBeNull();
    });

    it("refuses a title match whose author disagrees", async () => {
      await insert("Dune", "Frank Herbert", 900);
      expect(await matchSyncDocument(db, { filename: "Ursula K. Le Guin - Dune.epub" })).toBeNull();
    });

    it("does not match a book that merely ranks first for the filename", async () => {
      await insert("The Girl with the Dragon Tattoo", "Stieg Larsson", 100);
      expect(await matchSyncDocument(db, { filename: "The Girl.epub" })).toBeNull();
    });

    it("tolerates punctuation and stop-word differences in the title", async () => {
      const id = await insert("The Hitchhiker's Guide to the Galaxy", "Douglas Adams", 900);
      expect(
        await matchSyncDocument(db, {
          filename: "Douglas Adams - Hitchhikers Guide to the Galaxy.epub",
        }),
      ).toBe(id);
    });

    it("does not accept a sequel that merely contains the title", async () => {
      // "Dune" is a content-word subset of "Dune Messiah" and the author agrees,
      // so one-directional containment would link the user's progress to the
      // wrong book. A different book by the same author is the easiest way to
      // get this wrong and the hardest for the user to notice.
      await insert("Dune Messiah", "Frank Herbert", 900);
      expect(await matchSyncDocument(db, { filename: "Frank Herbert - Dune.epub" })).toBeNull();
    });

    it("ignores a series tail on the catalogue title", async () => {
      const id = await insert("Dune (Dune Chronicles #1)", "Frank Herbert", 900);
      expect(await matchSyncDocument(db, { filename: "Frank Herbert - Dune.epub" })).toBe(id);
    });
  });
});

describe("matchSyncDocumentForUser", () => {
  let db: Database;

  const insert = async (title: string, authors: string, ratingsCount = 0): Promise<HiveId> => {
    const id = getHiveId({ title, authors });
    await db
      .insertInto("hive_book")
      .values({
        id: id as never,
        title,
        rawTitle: title,
        authors,
        ratingsCount,
        source: "goodreads",
        thumbnail: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
      .execute();
    return id;
  };

  const upload = async (opts: {
    contentHash: string;
    filename: string;
    title: string;
    authors?: string | null;
    hiveId?: HiveId | null;
  }) => {
    const now = new Date().toISOString();
    await db
      .insertInto("personal_book")
      .values({
        userDid: DID,
        contentHash: opts.contentHash,
        hiveId: opts.hiveId ?? null,
        filename: opts.filename,
        filenameHash: koreaderFilenameHash(opts.filename),
        filenameKey: filenameKey(opts.filename),
        title: opts.title,
        authors: opts.authors ?? null,
        language: null,
        format: "epub",
        mime: "application/epub+zip",
        filePath: "/tmp/x.epub",
        coverPath: null,
        coverMime: null,
        sizeBytes: 1,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  };

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("matches a default-configured client, which sends only a content hash", async () => {
    // KOReader defaults: checksum_method BINARY, send_metadata off. The whole
    // request identifies the book as one partial-MD5 and nothing else, so
    // matching the payload alone can never work — but that hash is the
    // contentHash of a file whose metadata we parsed at upload time.
    const id = await insert("The Dispossessed", "Ursula K. Le Guin");
    await upload({
      contentHash: "partial-md5",
      filename: "book.epub",
      title: "The Dispossessed",
      authors: "Ursula K. Le Guin",
    });

    expect(await matchSyncDocument(db, { title: null, authors: null, filename: null })).toBeNull();
    expect(await matchSyncDocumentForUser(db, DID, { documentHash: "partial-md5" })).toBe(id);
  });

  it("inherits a link the user already established on the file", async () => {
    const id = await insert("Dune", "Frank Herbert");
    await upload({
      contentHash: "partial-md5",
      filename: "book.epub",
      title: "Something Unmatchable",
      hiveId: id,
    });

    expect(await matchSyncDocumentForUser(db, DID, { documentHash: "partial-md5" })).toBe(id);
  });

  it("writes the resolved book back onto the file and marks it owned", async () => {
    const id = await insert("The Dispossessed", "Ursula K. Le Guin");
    await upload({
      contentHash: "partial-md5",
      filename: "book.epub",
      title: "The Dispossessed",
      authors: "Ursula K. Le Guin",
    });
    const now = new Date().toISOString();
    await db
      .insertInto("user_book")
      .values({
        uri: "at://x/1",
        cid: "c",
        userDid: DID,
        createdAt: now,
        indexedAt: now,
        hiveId: id,
        title: "The Dispossessed",
        authors: "Ursula K. Le Guin",
        owned: 0,
      } as never)
      .execute();

    await matchSyncDocumentForUser(db, DID, { documentHash: "partial-md5" });

    const file = await db.selectFrom("personal_book").select("hiveId").executeTakeFirstOrThrow();
    expect(file.hiveId).toBe(id);
    const book = await db.selectFrom("user_book").select("owned").executeTakeFirstOrThrow();
    expect(book.owned).toBe(1);
  });

  it("splits comma-separated authors, which is how uploads store them", async () => {
    // `parseBook` joins epub dc:creator values with ", ".
    const id = await insert("Good Omens", "Terry Pratchett", 900);
    await upload({
      contentHash: "partial-md5",
      filename: "Good Omens.epub",
      title: "Good Omens",
      authors: "Neil Gaiman, Terry Pratchett",
    });

    expect(await matchSyncDocumentForUser(db, DID, { documentHash: "partial-md5" })).toBe(id);
  });

  it("still un-inverts a single Last, First author", async () => {
    // The same comma that separates two authors also inverts one name, so both
    // readings are tried rather than guessed between.
    const id = await insert("The Dispossessed", "Ursula K. Le Guin", 900);
    await upload({
      contentHash: "partial-md5",
      filename: "x.epub",
      title: "The Dispossessed",
      authors: "Le Guin, Ursula K.",
    });

    expect(await matchSyncDocumentForUser(db, DID, { documentHash: "partial-md5" })).toBe(id);
  });

  it("does not reach another user's uploads", async () => {
    await insert("The Dispossessed", "Ursula K. Le Guin");
    await upload({
      contentHash: "partial-md5",
      filename: "book.epub",
      title: "The Dispossessed",
      authors: "Ursula K. Le Guin",
    });

    expect(
      await matchSyncDocumentForUser(db, "did:plc:someoneelse", { documentHash: "partial-md5" }),
    ).toBeNull();
  });
});
