import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { wrapBunSqliteForKysely } from "../../bun-sqlite-kysely";
import type { DatabaseSchema } from "../../db";
import type { ImportContext } from "./types";
import type { SessionClient } from "../../auth/client";

// Mock getUserRepoRecords to avoid needing valid CAR data from a real PDS
const mockGetUserRepoRecords = mock(async () => ({
  books: new Map(),
  buzzes: new Map(),
}));

mock.module("../../utils/getBook", () => ({
  getUserRepoRecords: mockGetUserRepoRecords,
  updateBookRecords: mock(async () => {}),
  updateBookRecord: mock(async () => ({ book: {}, userBook: {} })),
  getUserBook: mock(async () => null),
  updateUserBook: mock(async () => {}),
  getBookRecord: mock(async () => null),
}));

// Import after mocking
const { processGoodreadsImport, processStorygraphImport } = await import("./logic");

// --- Test helpers ---

/** Create a real in-memory SQLite DB with just the tables the import logic needs. */
function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });

  // Create minimal tables needed by import logic
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS hive_book (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      rawTitle TEXT,
      authors TEXT NOT NULL,
      cover TEXT,
      thumbnail TEXT,
      description TEXT,
      rating REAL,
      ratingsCount INTEGER,
      source TEXT,
      sourceId TEXT,
      sourceUrl TEXT,
      identifiers TEXT,
      series TEXT,
      meta TEXT,
      enrichedAt TEXT,
      hiveBookAtUri TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_book (
      uri TEXT PRIMARY KEY,
      userDid TEXT NOT NULL,
      hiveId TEXT NOT NULL,
      cid TEXT,
      title TEXT,
      authors TEXT,
      status TEXT,
      owned INTEGER DEFAULT 0,
      startedAt TEXT,
      finishedAt TEXT,
      review TEXT,
      stars INTEGER,
      bookProgress TEXT,
      createdAt TEXT,
      indexedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS book_id_map (
      hiveId TEXT,
      type TEXT,
      value TEXT,
      PRIMARY KEY (hiveId, type)
    );

    CREATE TABLE IF NOT EXISTS hive_book_genre (
      genre TEXT,
      hiveId TEXT,
      PRIMARY KEY (genre, hiveId)
    );
  `);

  return { db, sqlite };
}

/** Seed a hive_book row so the import can match against it. */
function seedHiveBook(
  sqlite: DatabaseSync,
  id: string,
  rawTitle: string,
  authors: string,
  cover: string | null = null,
) {
  const stmt = sqlite.prepare(
    `INSERT INTO hive_book (id, title, rawTitle, authors, cover, thumbnail, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, '', datetime('now'), datetime('now'))`,
  );
  stmt.run(id, rawTitle, rawTitle, authors, cover);
}

const GOODREADS_CSV = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
36510196,Old Man's War,John Scalzi,"Scalzi, John",,,,5,4.23,Tor Books,Kindle Edition,318,2007,2005,2024/12/15,2025/02/14,read,"read (#1)",read,Great book!,false,,1,1
18143945,Europe in Autumn,Dave Hutchinson,"Hutchinson, Dave",,,,0,3.71,Solaris,Paperback,429,2014,2014,,2025/02/21,to-read,"to-read (#171)",to-read,,,,0,0`;

const STORYGRAPH_CSV = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warnings (Description),Tags,Owned?
Old Man's War,John Scalzi,,9780765348272,paperback,read,2025/01/10,2025/02/15,,1,,,,,,,,4.5,,,,No
The Left Hand of Darkness,Ursula K. Le Guin,,9780441478125,paperback,to-read,2025/03/01,,,,,,,,,,,,,,No`;

/** Mock agent that records calls but returns fake success responses. */
function createMockAgent(): SessionClient {
  const calls: Array<{ method: string; name: string; opts?: any }> = [];
  return {
    did: "did:plc:test123",
    get: mock(async (name: string, opts?: any) => {
      calls.push({ method: "get", name, opts });
      if (name === "com.atproto.sync.getRepo") {
        // Return not-ok so getUserRepoRecords uses empty Uint8Array fallback
        return { ok: false, data: { error: "not-found", message: "test" } };
      }
      return { ok: true, data: {} };
    }) as any,
    post: mock(async (name: string, opts?: any) => {
      calls.push({ method: "post", name, opts });
      if (name === "com.atproto.repo.applyWrites") {
        const writes = opts?.input?.writes ?? [];
        return {
          ok: true,
          data: {
            results: writes.map((_: any, i: number) => ({
              $type: "com.atproto.repo.applyWrites#createResult",
              uri: `at://did:plc:test123/buzz.bookhive.book/fake-rkey-${i}`,
              cid: `fake-cid-${i}`,
            })),
          },
        };
      }
      return { ok: true, data: {} };
    }) as any,
    _calls: calls,
  } as SessionClient & { _calls: typeof calls };
}

function createMockCtx(db: Kysely<DatabaseSchema>): ImportContext {
  const events: Record<string, unknown>[] = [];

  // Minimal KV that returns empty for everything (search cache misses are fine)
  const kv = {
    get: mock(async () => null),
    set: mock(async () => {}),
    del: mock(async () => {}),
    has: mock(async () => false),
    getKeys: mock(async () => []),
    getMeta: mock(async () => null),
    setItem: mock(async () => {}),
    getItem: mock(async () => null),
    hasItem: mock(async () => false),
    setItems: mock(async () => {}),
    removeItem: mock(async () => {}),
    clear: mock(async () => {}),
    dispose: mock(async () => {}),
    mount: mock(() => {}),
    unmount: mock(() => {}),
    getMount: mock(() => null),
    getMounts: mock(() => []),
    watch: mock(() => () => {}),
    unwatch: mock(() => {}),
    keys: mock(async () => []),
  } as any;

  return {
    db,
    kv,
    serviceAccountAgent: null,
    addWideEventContext: mock((ctx: Record<string, unknown>) => {
      events.push(ctx);
    }),
    _events: events,
  } as ImportContext & { _events: typeof events };
}

// --- Tests ---

describe("processGoodreadsImport", () => {
  it("emits import-start, book-load, book-upload, and import-complete SSE events for matched books", async () => {
    const { db, sqlite } = createTestDb();
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi", "https://covers.example/omw.jpg");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const sseEvents: any[] = [];

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE: (data) => {
        sseEvents.push(JSON.parse(data));
      },
    });

    const eventTypes = sseEvents.map((e) => e.event);

    // Should have the core lifecycle events
    expect(eventTypes).toContain("import-start");
    expect(eventTypes).toContain("book-load");
    expect(eventTypes).toContain("import-complete");

    // import-complete should have the right counts
    const complete = sseEvents.find((e) => e.event === "import-complete");
    expect(complete).toBeDefined();
    expect(complete.stage).toBe("complete");
    // 1 matched (Old Man's War), 1 unmatched (Europe in Autumn)
    expect(complete.stageProgress.current).toBe(1);
    expect(complete.stageProgress.total).toBe(2);

    // Should have failed book details for Europe in Autumn
    expect(complete.failedBooks).toHaveLength(1);
    expect(complete.failedBooks[0].title).toBe("Europe in Autumn");
    expect(complete.failedBooks[0].author).toBe("Dave Hutchinson");
  });

  it("reports all books as failed when none match in the database", async () => {
    const { db } = createTestDb(); // empty DB — no hive_book rows
    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const sseEvents: any[] = [];

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE: (data) => {
        sseEvents.push(JSON.parse(data));
      },
    });

    const complete = sseEvents.find((e) => e.event === "import-complete");
    expect(complete.failedBooks).toHaveLength(2);
    expect(complete.stageProgress.current).toBe(0);
  });

  it("handles empty CSV gracefully", async () => {
    const { db } = createTestDb();
    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const sseEvents: any[] = [];
    const emptyCsv = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies\n`;

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(emptyCsv).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE: (data) => {
        sseEvents.push(JSON.parse(data));
      },
    });

    const complete = sseEvents.find((e) => e.event === "import-complete");
    expect(complete).toBeDefined();
    expect(complete.stageProgress.current).toBe(0);
    expect(complete.stageProgress.total).toBe(0);
  });
});

describe("processStorygraphImport", () => {
  it("emits correct SSE lifecycle events for StoryGraph CSV", async () => {
    const { db, sqlite } = createTestDb();
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi", "https://covers.example/omw.jpg");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const sseEvents: any[] = [];

    await processStorygraphImport({
      csvData: new TextEncoder().encode(STORYGRAPH_CSV).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE: (data) => {
        sseEvents.push(JSON.parse(data));
      },
    });

    const eventTypes = sseEvents.map((e) => e.event);
    expect(eventTypes).toContain("import-start");
    expect(eventTypes).toContain("import-complete");

    const complete = sseEvents.find((e) => e.event === "import-complete");
    // 1 matched (Old Man's War), 1 unmatched (Left Hand of Darkness)
    expect(complete.stageProgress.current).toBe(1);
    expect(complete.stageProgress.total).toBe(2);
    expect(complete.failedBooks).toHaveLength(1);
    expect(complete.failedBooks[0].title).toBe("The Left Hand of Darkness");
  });
});
