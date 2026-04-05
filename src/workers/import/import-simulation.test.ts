/**
 * Simulated integration tests for the import pipeline.
 *
 * Uses real CSV rows from actual Goodreads/StoryGraph exports, with mocked
 * network calls that use realistic delays based on measured latencies:
 *
 *   findBookDetails (Goodreads scraper):  p50 ~270ms, p90 ~650ms, max ~650ms
 *   updateBookRecords (PDS batch write):  ~500-2000ms
 *   updateBookRecord (PDS individual):    ~200-500ms
 *
 * These tests verify SSE event flow timing, ordering, and progress granularity
 * without hitting any real network endpoints.
 */
import { describe, it, expect, mock } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { wrapBunSqliteForKysely } from "../../bun-sqlite-kysely";
import type { DatabaseSchema } from "../../db";
import type { ImportContext } from "./types";
import type { SessionClient } from "../../auth/client";

// ─── Realistic delay constants (from measured latencies) ────────────────────
const SEARCH_DELAY_P50 = 50; // Scaled down for test speed; real p50 ~270ms
const SEARCH_DELAY_P90 = 120; // Scaled down; real p90 ~650ms
const PDS_BATCH_DELAY = 80; // Scaled down; real ~500-2000ms
const PDS_INDIVIDUAL_DELAY = 40; // Scaled down; real ~200-500ms

/** Returns a delay in ms that roughly follows p50/p90 distribution. */
function realisticSearchDelay(): number {
  return Math.random() < 0.9 ? SEARCH_DELAY_P50 : SEARCH_DELAY_P90;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Mock network modules ───────────────────────────────────────────────────

const mockSearchBooks = mock(async () => []);
const mockGetUserRepoRecords = mock(async () => ({
  books: new Map(),
  buzzes: new Map(),
}));
const mockUpdateBookRecords = mock(async () => {
  await delay(PDS_BATCH_DELAY);
});
const mockUpdateBookRecord = mock(async () => {
  await delay(PDS_INDIVIDUAL_DELAY);
  return { book: {}, userBook: {} };
});

void mock.module("../../routes/lib", () => ({
  searchBooks: async ({ query: _query }: { query: string }) => {
    await delay(realisticSearchDelay());
    return mockSearchBooks();
  },
}));

void mock.module("../../utils/getBook", () => ({
  getUserRepoRecords: mockGetUserRepoRecords,
  updateBookRecords: mockUpdateBookRecords,
  updateBookRecord: mockUpdateBookRecord,
  getUserBook: mock(async () => null),
  updateUserBook: mock(async () => {}),
  getBookRecord: mock(async () => null),
}));

// Import after mocking
const { processGoodreadsImport, processStorygraphImport } = await import("./logic");

// ─── Real CSV data from actual exports ──────────────────────────────────────

const GOODREADS_CSV_15_ROWS = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
209439446,"Onyx Storm (The Empyrean, #3)",Rebecca Yarros,"Yarros, Rebecca",,"=""1649374186""","=""9781649374189""",0,4.23,Red Tower Books,Hardcover,527,2025,2025,,2024/07/31,currently-reading,currently-reading (#1),currently-reading,,,,1,0
61755703,"The Fury of the Gods (The Bloodsworn Saga, #3)",John Gwynne,"Gwynne, John",,"=""0356514293""","=""9780356514291""",0,4.48,Orbit,Paperback,528,2024,2024,,2025/05/12,to-read,to-read (#109),to-read,,,,0,0
52694527,"The Shadow of the Gods (The Bloodsworn Saga, #1)",John Gwynne,"Gwynne, John",,"=""0356514188""","=""9780356514185""",4,4.21,Orbit,Hardcover,480,2021,2021,2025/05/12,2025/04/15,,,read,,,,1,0
211004089,Wild Dark Shore,Charlotte McConaghy,"McConaghy, Charlotte",,"=""1250827957""","=""9781250827951""",0,4.26,Flatiron Books,Hardcover,303,2025,2025,,2025/04/20,to-read,to-read (#106),to-read,,,,0,0
195790847,A Sorceress Comes to Call,T. Kingfisher,"Kingfisher, T.",,"=""1250244072""","=""9781250244079""",3,4.08,Tor Books,Hardcover,327,2024,2024,2025/04/14,2024/07/21,,,read,,,,1,0
194036469,"DallerGut Dream Department Store (DallerGut Dream Department Store, #1)",Lee Mi-ye,"Mi-ye, Lee",Sandy Joosun Lee,"=""1035412748""","=""9781035412747""",5,3.68,Wildfire,Kindle Edition,243,2023,2020,2025/03/11,2025/03/06,,,read,,,,1,0
76715522,"Kingdom of Ash (Throne of Glass, #7)",Sarah J. Maas,"Maas, Sarah J.",,"=""1639731067""","=""9781639731060""",5,4.71,Bloomsbury Publishing,Hardcover,984,2023,2018,2025/03/05,2025/02/17,,,read,,,,1,0
76714487,"Tower of Dawn (Throne of Glass, #6)",Sarah J. Maas,"Maas, Sarah J.",,"=""1639731040""","=""9781639731046""",4,4.27,Bloomsbury Publishing,Hardcover,663,2023,2017,2025/02/16,2025/01/08,,,read,,,,1,0
76713323,"Empire of Storms (Throne of Glass, #5)",Sarah J. Maas,"Maas, Sarah J.",,"=""1639731024""","=""9781639731022""",5,4.63,Bloomsbury Publishing,Hardcover,693,2023,2016,2025/02/14,2024/12/05,,,read,,,,1,0
22055262,"A Darker Shade of Magic (Shades of Magic, #1)",Victoria E. Schwab,"Schwab, Victoria E.",,"=""0765376458""","=""9780765376459""",0,4.04,Tor,Hardcover,400,2015,2015,,2025/01/30,to-read,to-read (#100),to-read,,,,0,0
54326657,"A Fire Endless (Elements of Cadence, #2)",Rebecca   Ross,"Ross, Rebecca",,"=""0008514704""","=""9780008514709""",5,4.35,Harper Voyager,Hardcover,512,2022,2022,2025/01/08,2024/06/19,,,read,,,,1,0
186074,"The Name of the Wind (The Kingkiller Chronicle, #1)",Patrick Rothfuss,"Rothfuss, Patrick",,"=""075640407X""","=""9780756404079""",0,4.52,Penguin Group DAW,Hardcover,662,2007,2007,,2024/12/19,to-read,to-read (#95),to-read,,,,0,0
36510196,Old Man's War,John Scalzi,"Scalzi, John",,"=""0765348276""","=""9780765348272""",5,4.23,Tor Books,Kindle Edition,318,2007,2005,2024/12/15,2025/02/14,,,read,,,,1,1
12974372,"A Natural History of Dragons (The Memoirs of Lady Trent, #1)",Marie Brennan,"Brennan, Marie",,"=""0765331969""","=""9780765331960""",3,3.83,Tor Books,Hardcover,334,2013,2013,,2013/12/29,,,read,,,,2,0
63273108,Medusa's Sisters,Lauren J.A. Bear,"Bear, Lauren J.A.",,"=""0593547764""","=""9780593547762""",0,4.18,Ace,Hardcover,354,2023,2023,,2025/04/18,to-read,to-read (#105),to-read,,,,0,0`;

const STORYGRAPH_CSV_12_ROWS = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
Assassin's Apprentice,Robin Hobb,"",9780007562251,paperback,read,2024/12/01,"","",1,"",,,,,,,,,"",,"",No
The Adventures of Tom Bombadil and Other Verses from the Red Book,J.R.R. Tolkien,Pauline Baynes (Illustrator),9780007557271,hardcover,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
Whipping Star,Frank Herbert,"",042504355X,paperback,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
Oathbringer,Brandon Sanderson,"",9780765326379,hardcover,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
The Fury of the Gods,John Gwynne,"",9780356514260,hardcover,to-read,2025/05/24,"","",0,"",,,,,,,,,"",,"",No
Neuromancer,William Gibson,James Warhola (Illustrator),9780441569564,paperback,read,2024/12/01,"","",1,"",,,,,,,,,"",,"",No
The Way of Kings,Brandon Sanderson,"",9780765326355,hardcover,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
A Deepness in the Sky,Vernor Vinge,"",9780812536355,paperback,read,2024/12/01,2024/12/12,2024/12/01-2024/12/12,1,"",,,,,,,,,"",,"",No
Dune,Frank Herbert,"",9780593099322,hardcover,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
Leviathan Wakes,James S.A. Corey,"",9781841499895,paperback,read,2024/12/01,"","",1,"",,,,,,,,,"",,"",No
Chapterhouse: Dune,Frank Herbert,"",9780593098271,paperback,read,2024/12/12,"","",1,"",,,,,,,,,"",,"",No
Dreams of Steel,Glen Cook,"",9780765382641,paperback,read,2025/11/13,"","",1,"",,,,,,,,,"",,"",No`;

// ─── Test infrastructure ────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: wrapBunSqliteForKysely(sqlite),
    }),
  });

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

function createMockAgent(): SessionClient {
  const calls: Array<{ method: string; name: string; opts?: any }> = [];
  return {
    did: "did:plc:simtest123",
    get: mock(async (name: string, opts?: any) => {
      calls.push({ method: "get", name, opts });
      if (name === "com.atproto.sync.getRepo") {
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
              uri: `at://did:plc:simtest123/buzz.bookhive.book/fake-rkey-${i}`,
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

// ─── Parsed SSE event type ──────────────────────────────────────────────────

interface SSEEvent {
  event: string;
  stage?: string;
  stageProgress?: {
    current?: number;
    total?: number;
    message?: string;
  };
  title?: string;
  author?: string;
  processed?: number;
  failed?: number;
  total?: number;
  uploaded?: number;
  id?: number;
  ts: string;
  book?: Record<string, unknown>;
  failedBooks?: Array<{ title: string; author: string }>;
  unmatchedCount?: number;
}

function collectSSEEvents(): { events: SSEEvent[]; onSSE: (data: string) => void } {
  const events: SSEEvent[] = [];
  return {
    events,
    onSSE: (data: string) => {
      events.push(JSON.parse(data));
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("import pipeline simulation — Goodreads", () => {
  it("processes 15 real CSV rows with correct SSE event ordering", async () => {
    const { db, sqlite } = createTestDb();

    // Seed 10 of the 15 books so we get a mix of matched/unmatched
    seedHiveBook(sqlite, "bk_onyx", "Onyx Storm (The Empyrean, #3)", "Rebecca Yarros");
    seedHiveBook(
      sqlite,
      "bk_sotg",
      "The Shadow of the Gods (The Bloodsworn Saga, #1)",
      "John Gwynne",
    );
    seedHiveBook(sqlite, "bk_wild", "Wild Dark Shore", "Charlotte McConaghy");
    seedHiveBook(sqlite, "bk_sorc", "A Sorceress Comes to Call", "T. Kingfisher");
    seedHiveBook(
      sqlite,
      "bk_dall",
      "DallerGut Dream Department Store (DallerGut Dream Department Store, #1)",
      "Lee Mi-ye",
    );
    seedHiveBook(sqlite, "bk_koa", "Kingdom of Ash (Throne of Glass, #7)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_tod", "Tower of Dawn (Throne of Glass, #6)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_eos", "Empire of Storms (Throne of Glass, #5)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(
      sqlite,
      "bk_nhd",
      "A Natural History of Dragons (The Memoirs of Lady Trent, #1)",
      "Marie Brennan",
    );

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV_15_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const eventTypes = events.map((e) => e.event);

    // First event must be import-start
    expect(eventTypes[0]).toBe("import-start");

    // Last event must be import-complete
    expect(eventTypes[eventTypes.length - 1]).toBe("import-complete");

    // batch-save events must appear before their corresponding book-upload events
    const batchSaveIndices = eventTypes
      .map((e, i) => (e === "batch-save" ? i : -1))
      .filter((i) => i !== -1);
    const bookUploadIndices = eventTypes
      .map((e, i) => (e === "book-upload" ? i : -1))
      .filter((i) => i !== -1);

    // Every batch-save should come before at least one book-upload
    for (const bsi of batchSaveIndices) {
      const uploadsAfter = bookUploadIndices.filter((bui) => bui > bsi);
      expect(uploadsAfter.length).toBeGreaterThan(0);
    }

    // No book-upload should appear before the first batch-save
    if (batchSaveIndices.length > 0 && bookUploadIndices.length > 0) {
      expect(bookUploadIndices[0]!).toBeGreaterThan(batchSaveIndices[0]!);
    }

    // import-complete should have correct counts
    const complete = events.find((e) => e.event === "import-complete")!;
    expect(complete.stageProgress!.total).toBe(15);
    // 10 seeded books should be matched
    expect(complete.stageProgress!.current).toBe(10);
    // 5 unmatched books
    expect(complete.failedBooks!.length).toBe(5);
  });

  it("emits all timestamps in ascending order", async () => {
    const { db, sqlite } = createTestDb();
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(sqlite, "bk_onyx", "Onyx Storm (The Empyrean, #3)", "Rebecca Yarros");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV_15_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    // All timestamps should be in non-decreasing order
    const timestamps = events.map((e) => new Date(e.ts).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });

  it("has no excessively long gaps between consecutive SSE events", async () => {
    const { db, sqlite } = createTestDb();
    // Seed all 15 to maximize matched books and see full pipeline
    seedHiveBook(sqlite, "bk_onyx", "Onyx Storm (The Empyrean, #3)", "Rebecca Yarros");
    seedHiveBook(
      sqlite,
      "bk_fotg",
      "The Fury of the Gods (The Bloodsworn Saga, #3)",
      "John Gwynne",
    );
    seedHiveBook(
      sqlite,
      "bk_sotg",
      "The Shadow of the Gods (The Bloodsworn Saga, #1)",
      "John Gwynne",
    );
    seedHiveBook(sqlite, "bk_wild", "Wild Dark Shore", "Charlotte McConaghy");
    seedHiveBook(sqlite, "bk_sorc", "A Sorceress Comes to Call", "T. Kingfisher");
    seedHiveBook(
      sqlite,
      "bk_dall",
      "DallerGut Dream Department Store (DallerGut Dream Department Store, #1)",
      "Lee Mi-ye",
    );
    seedHiveBook(sqlite, "bk_koa", "Kingdom of Ash (Throne of Glass, #7)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_tod", "Tower of Dawn (Throne of Glass, #6)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_eos", "Empire of Storms (Throne of Glass, #5)", "Sarah J. Maas");
    seedHiveBook(
      sqlite,
      "bk_adsm",
      "A Darker Shade of Magic (Shades of Magic, #1)",
      "Victoria E. Schwab",
    );
    seedHiveBook(sqlite, "bk_afe", "A Fire Endless (Elements of Cadence, #2)", "Rebecca   Ross");
    seedHiveBook(
      sqlite,
      "bk_notw",
      "The Name of the Wind (The Kingkiller Chronicle, #1)",
      "Patrick Rothfuss",
    );
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(
      sqlite,
      "bk_nhd",
      "A Natural History of Dragons (The Memoirs of Lady Trent, #1)",
      "Marie Brennan",
    );
    seedHiveBook(sqlite, "bk_med", "Medusa's Sisters", "Lauren J.A. Bear");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV_15_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const timestamps = events.map((e) => new Date(e.ts).getTime());

    // With batch size 10, we process items within a batch concurrently.
    // The max gap between events should be bounded — we allow a generous
    // 3000ms threshold (the mocked search delay is ~50-120ms per book,
    // plus the batch write at ~80ms).
    const MAX_GAP_MS = 3000;
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i]! - timestamps[i - 1]!;
      expect(gap).toBeLessThanOrEqual(MAX_GAP_MS);
    }
  });

  it("provides granular progress updates with batch size 10", async () => {
    const { db, sqlite } = createTestDb();
    // Seed all 15 books
    seedHiveBook(sqlite, "bk_onyx", "Onyx Storm (The Empyrean, #3)", "Rebecca Yarros");
    seedHiveBook(
      sqlite,
      "bk_fotg",
      "The Fury of the Gods (The Bloodsworn Saga, #3)",
      "John Gwynne",
    );
    seedHiveBook(
      sqlite,
      "bk_sotg",
      "The Shadow of the Gods (The Bloodsworn Saga, #1)",
      "John Gwynne",
    );
    seedHiveBook(sqlite, "bk_wild", "Wild Dark Shore", "Charlotte McConaghy");
    seedHiveBook(sqlite, "bk_sorc", "A Sorceress Comes to Call", "T. Kingfisher");
    seedHiveBook(
      sqlite,
      "bk_dall",
      "DallerGut Dream Department Store (DallerGut Dream Department Store, #1)",
      "Lee Mi-ye",
    );
    seedHiveBook(sqlite, "bk_koa", "Kingdom of Ash (Throne of Glass, #7)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_tod", "Tower of Dawn (Throne of Glass, #6)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_eos", "Empire of Storms (Throne of Glass, #5)", "Sarah J. Maas");
    seedHiveBook(
      sqlite,
      "bk_adsm",
      "A Darker Shade of Magic (Shades of Magic, #1)",
      "Victoria E. Schwab",
    );
    seedHiveBook(sqlite, "bk_afe", "A Fire Endless (Elements of Cadence, #2)", "Rebecca   Ross");
    seedHiveBook(
      sqlite,
      "bk_notw",
      "The Name of the Wind (The Kingkiller Chronicle, #1)",
      "Patrick Rothfuss",
    );
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(
      sqlite,
      "bk_nhd",
      "A Natural History of Dragons (The Memoirs of Lady Trent, #1)",
      "Marie Brennan",
    );
    seedHiveBook(sqlite, "bk_med", "Medusa's Sisters", "Lauren J.A. Bear");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV_15_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    // With 15 books and batch size 10, expect 2 batches (10 + 5).
    // Each batch should produce: book-load events, then batch-save, then book-upload events.
    const bookLoadEvents = events.filter((e) => e.event === "book-load");
    const bookUploadEvents = events.filter((e) => e.event === "book-upload");
    const batchSaveEvents = events.filter((e) => e.event === "batch-save");

    // We should have 15 book-load events (one per book searched)
    expect(bookLoadEvents.length).toBe(15);

    // We should have 2 batch-save events (one per batch)
    expect(batchSaveEvents.length).toBe(2);

    // We should have 15 book-upload events (one per matched book)
    expect(bookUploadEvents.length).toBe(15);

    // The book-upload processed counter should increment monotonically
    const processedValues = bookUploadEvents.map((e) => e.processed!);
    for (let i = 1; i < processedValues.length; i++) {
      expect(processedValues[i]!).toBeGreaterThanOrEqual(processedValues[i - 1]!);
    }
  });
});

describe("import pipeline simulation — StoryGraph", () => {
  it("processes 12 real CSV rows with correct event flow", async () => {
    const { db, sqlite } = createTestDb();

    // Seed 8 of 12
    seedHiveBook(sqlite, "bk_aa", "Assassin's Apprentice", "Robin Hobb");
    seedHiveBook(sqlite, "bk_oath", "Oathbringer", "Brandon Sanderson");
    seedHiveBook(sqlite, "bk_neuro", "Neuromancer", "William Gibson");
    seedHiveBook(sqlite, "bk_wok", "The Way of Kings", "Brandon Sanderson");
    seedHiveBook(sqlite, "bk_deep", "A Deepness in the Sky", "Vernor Vinge");
    seedHiveBook(sqlite, "bk_dune", "Dune", "Frank Herbert");
    seedHiveBook(sqlite, "bk_lev", "Leviathan Wakes", "James S.A. Corey");
    seedHiveBook(sqlite, "bk_ch", "Chapterhouse: Dune", "Frank Herbert");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processStorygraphImport({
      csvData: new TextEncoder().encode(STORYGRAPH_CSV_12_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const eventTypes = events.map((e) => e.event);

    expect(eventTypes[0]).toBe("import-start");
    expect(eventTypes[eventTypes.length - 1]).toBe("import-complete");

    const complete = events.find((e) => e.event === "import-complete")!;
    expect(complete.stageProgress!.total).toBe(12);
    expect(complete.stageProgress!.current).toBe(8);
    expect(complete.failedBooks!.length).toBe(4);
  });

  it("batch-save events always precede their book-upload events", async () => {
    const { db, sqlite } = createTestDb();

    // Seed all 12
    seedHiveBook(sqlite, "bk_aa", "Assassin's Apprentice", "Robin Hobb");
    seedHiveBook(
      sqlite,
      "bk_tomb",
      "The Adventures of Tom Bombadil and Other Verses from the Red Book",
      "J.R.R. Tolkien",
    );
    seedHiveBook(sqlite, "bk_whip", "Whipping Star", "Frank Herbert");
    seedHiveBook(sqlite, "bk_oath", "Oathbringer", "Brandon Sanderson");
    seedHiveBook(sqlite, "bk_fotg", "The Fury of the Gods", "John Gwynne");
    seedHiveBook(sqlite, "bk_neuro", "Neuromancer", "William Gibson");
    seedHiveBook(sqlite, "bk_wok", "The Way of Kings", "Brandon Sanderson");
    seedHiveBook(sqlite, "bk_deep", "A Deepness in the Sky", "Vernor Vinge");
    seedHiveBook(sqlite, "bk_dune", "Dune", "Frank Herbert");
    seedHiveBook(sqlite, "bk_lev", "Leviathan Wakes", "James S.A. Corey");
    seedHiveBook(sqlite, "bk_ch", "Chapterhouse: Dune", "Frank Herbert");
    seedHiveBook(sqlite, "bk_dos", "Dreams of Steel", "Glen Cook");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processStorygraphImport({
      csvData: new TextEncoder().encode(STORYGRAPH_CSV_12_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const eventTypes = events.map((e) => e.event);
    const batchSaveIndices = eventTypes
      .map((e, i) => (e === "batch-save" ? i : -1))
      .filter((i) => i !== -1);
    const bookUploadIndices = eventTypes
      .map((e, i) => (e === "book-upload" ? i : -1))
      .filter((i) => i !== -1);

    // With batch size 10, we expect 2 batches (10 + 2)
    expect(batchSaveIndices.length).toBe(2);

    // All book-uploads must come after the first batch-save
    if (bookUploadIndices.length > 0) {
      expect(bookUploadIndices[0]!).toBeGreaterThan(batchSaveIndices[0]!);
    }

    // Within each batch, the batch-save must be immediately followed by
    // book-upload events (no book-load events in between)
    for (const bsi of batchSaveIndices) {
      const nextEvent = events[bsi + 1];
      if (nextEvent) {
        expect(nextEvent.event).toBe("book-upload");
      }
    }
  });

  it("SSE event IDs are strictly monotonically increasing", async () => {
    const { db, sqlite } = createTestDb();
    seedHiveBook(sqlite, "bk_aa", "Assassin's Apprentice", "Robin Hobb");
    seedHiveBook(sqlite, "bk_dune", "Dune", "Frank Herbert");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    await processStorygraphImport({
      csvData: new TextEncoder().encode(STORYGRAPH_CSV_12_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const ids = events.map((e) => e.id!);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });
});

describe("import pipeline simulation — batch write fallback", () => {
  it("falls back to individual writes when batch write fails", async () => {
    const { db, sqlite } = createTestDb();
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(sqlite, "bk_sorc", "A Sorceress Comes to Call", "T. Kingfisher");

    // Make batch write fail so it falls back to individual writes
    mockUpdateBookRecords.mockImplementationOnce(async () => {
      await delay(PDS_BATCH_DELAY);
      throw new Error("Simulated PDS batch write failure");
    });

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { events, onSSE } = collectSSEEvents();

    // Use a small CSV with just 2 matched books
    const smallCsv = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
36510196,Old Man's War,John Scalzi,"Scalzi, John",,,,,4.23,,,318,2007,2005,2024/12/15,2025/02/14,,,read,,,,1,1
195790847,A Sorceress Comes to Call,T. Kingfisher,"Kingfisher, T.",,,,,4.08,,,327,2024,2024,2025/04/14,2024/07/21,,,read,,,,1,0`;

    await processGoodreadsImport({
      csvData: new TextEncoder().encode(smallCsv).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });

    const eventTypes = events.map((e) => e.event);

    // Should still complete successfully via individual fallback
    expect(eventTypes).toContain("import-complete");
    expect(eventTypes).toContain("batch-save");
    expect(eventTypes).toContain("book-upload");

    // The complete event should show the books were processed
    const complete = events.find((e) => e.event === "import-complete")!;
    expect(complete.stageProgress!.total).toBe(2);
  });
});

describe("import pipeline simulation — timing characteristics", () => {
  it("total pipeline time stays within expected bounds for 15 books", async () => {
    const { db, sqlite } = createTestDb();
    // Seed all 15
    seedHiveBook(sqlite, "bk_onyx", "Onyx Storm (The Empyrean, #3)", "Rebecca Yarros");
    seedHiveBook(
      sqlite,
      "bk_fotg",
      "The Fury of the Gods (The Bloodsworn Saga, #3)",
      "John Gwynne",
    );
    seedHiveBook(
      sqlite,
      "bk_sotg",
      "The Shadow of the Gods (The Bloodsworn Saga, #1)",
      "John Gwynne",
    );
    seedHiveBook(sqlite, "bk_wild", "Wild Dark Shore", "Charlotte McConaghy");
    seedHiveBook(sqlite, "bk_sorc", "A Sorceress Comes to Call", "T. Kingfisher");
    seedHiveBook(
      sqlite,
      "bk_dall",
      "DallerGut Dream Department Store (DallerGut Dream Department Store, #1)",
      "Lee Mi-ye",
    );
    seedHiveBook(sqlite, "bk_koa", "Kingdom of Ash (Throne of Glass, #7)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_tod", "Tower of Dawn (Throne of Glass, #6)", "Sarah J. Maas");
    seedHiveBook(sqlite, "bk_eos", "Empire of Storms (Throne of Glass, #5)", "Sarah J. Maas");
    seedHiveBook(
      sqlite,
      "bk_adsm",
      "A Darker Shade of Magic (Shades of Magic, #1)",
      "Victoria E. Schwab",
    );
    seedHiveBook(sqlite, "bk_afe", "A Fire Endless (Elements of Cadence, #2)", "Rebecca   Ross");
    seedHiveBook(
      sqlite,
      "bk_notw",
      "The Name of the Wind (The Kingkiller Chronicle, #1)",
      "Patrick Rothfuss",
    );
    seedHiveBook(sqlite, "bk_omw", "Old Man's War", "John Scalzi");
    seedHiveBook(
      sqlite,
      "bk_nhd",
      "A Natural History of Dragons (The Memoirs of Lady Trent, #1)",
      "Marie Brennan",
    );
    seedHiveBook(sqlite, "bk_med", "Medusa's Sisters", "Lauren J.A. Bear");

    const ctx = createMockCtx(db);
    const agent = createMockAgent();
    const { onSSE } = collectSSEEvents();

    const start = performance.now();
    await processGoodreadsImport({
      csvData: new TextEncoder().encode(GOODREADS_CSV_15_ROWS).buffer as ArrayBuffer,
      ctx,
      agent,
      onSSE,
    });
    const elapsed = performance.now() - start;

    // With batch size 10 and concurrent search within each batch:
    // Batch 1: ~SEARCH_DELAY_P50 (concurrent) + PDS_BATCH_DELAY = ~130ms
    // Batch 2: ~SEARCH_DELAY_P50 (concurrent) + PDS_BATCH_DELAY = ~130ms
    // Total should be well under 5s with our scaled-down delays
    expect(elapsed).toBeLessThan(5000);

    // But should take at least some time due to the delays
    expect(elapsed).toBeGreaterThan(50);
  });
});
