/**
 * The first tests of `src/xrpc/router.ts`.
 *
 * Scoped to the personal-library methods rather than named `router.test.ts`:
 * that file is 2000+ lines and 40 methods, and one suite per region stays
 * reviewable (and signposts `src/xrpc/lists.test.ts` for whoever needs it next).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "unstorage";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { AppContext, AppEnv } from "../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import { koreaderPartialMD5 } from "../utils/bookMetadata/index";
import { makeEpub, makeFb2 } from "../utils/bookMetadata/testFixtures";
import {
  bookFilePath,
  getLibraryTmpDir,
  getStorageQuota,
  personalBookDir,
} from "../utils/personalLibrary";
import { createXrpcRouter, type XrpcContext } from "./router";

const DID = "did:plc:testuser";
const OTHER_DID = "did:plc:someoneelse";

type TestApp = Hono<AppEnv>;

let db: Database;
let kv: Storage;
let wideEvent: Record<string, unknown>;

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const database = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(database, sqlite);
  return database;
}

function createApp(did: string | null = DID): TestApp {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db,
      kv,
      resolver: { resolveDidsToHandles: async () => ({}) },
      getSessionAgent: async () => (did ? { did } : null),
      baseIdResolver: { handle: { resolve: async () => undefined } },
      addWideEventContext: (fields: Record<string, unknown>) => Object.assign(wideEvent, fields),
    } as unknown as AppContext);
    await next();
  });
  createXrpcRouter<XrpcContext>(
    app as never,
    {
      searchBooks: async () => [],
      ensureBookIdentifiersCurrent: async () => {},
      getProfile: async () => null,
    } as never,
  );
  return app;
}

/** POST an ebook as a raw body, the way a programmatic client would. */
function uploadRequest(
  app: TestApp,
  bytes: Uint8Array,
  filename: string,
  init: { contentType?: string; contentLength?: boolean } = {},
) {
  const headers: Record<string, string> = {
    "content-type": init.contentType ?? "application/epub+zip",
  };
  if (init.contentLength !== false) headers["content-length"] = String(bytes.length);
  return app.request(
    `/xrpc/buzz.bookhive.uploadPersonalBook?filename=${encodeURIComponent(filename)}`,
    { method: "POST", body: bytes as BodyInit, headers },
  );
}

async function tmpEntries(): Promise<string[]> {
  try {
    return (await readdir(getLibraryTmpDir())).filter((n) => n.endsWith(".part"));
  } catch {
    return [];
  }
}

beforeEach(async () => {
  db = await createTestDb();
  kv = createStorage({ driver: memoryDriver() });
  wideEvent = {};
});

afterEach(async () => {
  for (const did of [DID, OTHER_DID]) {
    await rm(path.dirname(personalBookDir(did, "x")), { recursive: true, force: true }).catch(
      () => {},
    );
  }
  for (const name of await tmpEntries()) {
    await rm(path.join(getLibraryTmpDir(), name), { force: true });
  }
});

describe("XRPC uploadPersonalBook", () => {
  it("accepts a raw ebook body and stores it", async () => {
    const app = createApp();
    const bytes = makeEpub({ title: "Dune", authors: ["Frank Herbert"] });

    const res = await uploadRequest(app, bytes, "Dune.epub");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      book: { contentHash: string; title: string; authors?: string; sizeBytes: number };
      storageUsedBytes: number;
      storageQuotaBytes: number;
    };
    expect(body.book.title).toBe("Dune");
    expect(body.book.authors).toBe("Frank Herbert");
    expect(body.book.sizeBytes).toBe(bytes.length);
    expect(body.book.contentHash).toBe(koreaderPartialMD5(bytes));
    expect(body.storageUsedBytes).toBe(bytes.length);
    expect(body.storageQuotaBytes).toBe(getStorageQuota());

    expect(await Bun.file(bookFilePath(DID, body.book.contentHash, "epub")).exists()).toBe(true);
    expect(await tmpEntries()).toEqual([]);
  });

  it("accepts application/octet-stream, which is what real clients send", async () => {
    // Mobile document pickers and `curl --data-binary` both report this; the
    // lexicon's MIME list documents intent, but detectFormat is the real gate.
    const res = await uploadRequest(createApp(), makeEpub(), "x.epub", {
      contentType: "application/octet-stream",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a content type outside the lexicon's list before the handler runs", async () => {
    const res = await uploadRequest(createApp(), makeEpub(), "x.epub", {
      contentType: "application/json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("InvalidRequest");
  });

  it("requires the filename parameter", async () => {
    const app = createApp();
    const res = await app.request("/xrpc/buzz.bookhive.uploadPersonalBook", {
      method: "POST",
      body: makeEpub() as BodyInit,
      headers: { "content-type": "application/epub+zip" },
    });
    expect(res.status).toBe(400);
  });

  it("uses the filename to tell zip containers apart", async () => {
    // An EPUB and a CBZ are both zip archives; only the extension distinguishes
    // them, which is why `filename` is required rather than a header.
    const app = createApp();
    const res = await uploadRequest(app, makeEpub(), "book.cbz", {
      contentType: "application/vnd.comicbook+zip",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { book: { format: string } }).book.format).toBe("cbz");
  });

  it("401s without a session", async () => {
    const res = await uploadRequest(createApp(null), makeEpub(), "x.epub");
    expect(res.status).toBe(401);
  });

  it("409s a duplicate", async () => {
    const app = createApp();
    const bytes = makeEpub();
    expect((await uploadRequest(app, bytes, "x.epub")).status).toBe(200);

    const res = await uploadRequest(app, bytes, "x.epub");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("AlreadyExists");
  });

  it("400s an unsupported format", async () => {
    const res = await uploadRequest(
      createApp(),
      new TextEncoder().encode("plain text, not a book"),
      "notes.epub",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("InvalidRequest");
  });

  it("413s when the upload would cross the storage quota", async () => {
    const bytes = makeEpub();
    await db
      .insertInto("personal_book")
      .values({
        userDid: DID,
        contentHash: "seeded",
        filename: "seeded.epub",
        title: "Seeded",
        format: "epub",
        mime: "application/epub+zip",
        filePath: "/tmp/seeded.epub",
        sizeBytes: getStorageQuota() - bytes.length + 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })
      .execute();

    const res = await uploadRequest(createApp(), bytes, "x.epub");
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("QuotaExceeded");
    expect(await tmpEntries()).toEqual([]);
  });

  it("records a deliberate 4xx on the wide event without a stack", async () => {
    // The registration wrapper decides this from `status < 500`, and nothing
    // covered it before.
    await uploadRequest(createApp(), new TextEncoder().encode("nope"), "x.epub");
    expect(wideEvent["xrpc_handler"]).toBe("threw");
    const error = wideEvent["error"] as { message?: string; stack?: string } | undefined;
    expect(error?.message).toBeTruthy();
    expect(error?.stack).toBeUndefined();
  });

  it("keeps two users' identical uploads separate", async () => {
    const bytes = makeFb2();
    expect(
      (
        await uploadRequest(createApp(DID), bytes, "x.fb2", {
          contentType: "application/x-fictionbook+xml",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await uploadRequest(createApp(OTHER_DID), bytes, "x.fb2", {
          contentType: "application/x-fictionbook+xml",
        })
      ).status,
    ).toBe(200);

    const rows = await db.selectFrom("personal_book").select(["userDid"]).execute();
    expect(rows.map((r) => r.userDid).sort()).toEqual([OTHER_DID, DID].sort());
  });

  it("streams a body with no content-length", async () => {
    const res = await uploadRequest(createApp(), makeEpub(), "x.epub", { contentLength: false });
    expect(res.status).toBe(200);
  });
});

describe("XRPC getPersonalBookFile", () => {
  it("serves the stored bytes with download headers", async () => {
    const app = createApp();
    const bytes = makeEpub();
    const hash = (
      (await (await uploadRequest(app, bytes, "Dune.epub")).json()) as {
        book: { contentHash: string };
      }
    ).book.contentHash;

    const res = await app.request(`/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=${hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
    expect(res.headers.get("content-disposition")).toContain("Dune.epub");
    expect(res.headers.get("etag")).toBe(`"${hash}"`);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("answers If-None-Match with a 304 and no body", async () => {
    // The reason this matters: without it an e-reader re-downloads every book
    // on every scheduled sync.
    const app = createApp();
    const hash = (
      (await (await uploadRequest(app, makeEpub(), "x.epub")).json()) as {
        book: { contentHash: string };
      }
    ).book.contentHash;

    const res = await app.request(`/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=${hash}`, {
      headers: { "if-none-match": `"${hash}"` },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("404s another user's book rather than 403", async () => {
    const hash = (
      (await (await uploadRequest(createApp(DID), makeEpub(), "x.epub")).json()) as {
        book: { contentHash: string };
      }
    ).book.contentHash;

    const res = await createApp(OTHER_DID).request(
      `/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=${hash}`,
    );
    // 404, not 403: a different status would confirm the book exists.
    expect(res.status).toBe(404);
  });

  it("401s without a session", async () => {
    const res = await createApp(null).request(
      "/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=whatever",
    );
    expect(res.status).toBe(401);
  });
});

describe("XRPC getPersonalBookCover", () => {
  it("serves the extracted cover", async () => {
    const app = createApp();
    const hash = (
      (await (await uploadRequest(app, makeEpub(), "x.epub")).json()) as {
        book: { contentHash: string };
      }
    ).book.contentHash;

    const res = await app.request(`/xrpc/buzz.bookhive.getPersonalBookCover?contentHash=${hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBe(`"${hash}-cover"`);
  });

  it("answers If-None-Match on the cover", async () => {
    const app = createApp();
    const hash = (
      (await (await uploadRequest(app, makeEpub(), "x.epub")).json()) as {
        book: { contentHash: string };
      }
    ).book.contentHash;

    const res = await app.request(`/xrpc/buzz.bookhive.getPersonalBookCover?contentHash=${hash}`, {
      headers: { "if-none-match": `"${hash}-cover"` },
    });
    expect(res.status).toBe(304);
  });

  it("404s a book with neither a stored cover nor a catalog entry", async () => {
    const app = createApp();
    // FB2 fixture carries no cover image.
    const hash = (
      (await (
        await uploadRequest(app, makeFb2(), "x.fb2", {
          contentType: "application/x-fictionbook+xml",
        })
      ).json()) as { book: { contentHash: string } }
    ).book.contentHash;

    const res = await app.request(`/xrpc/buzz.bookhive.getPersonalBookCover?contentHash=${hash}`);
    expect(res.status).toBe(404);
  });

  it("redirects to the catalog image for a linked book with no stored cover", async () => {
    // The branch that used to be built with `Response.redirect`, whose headers
    // are immutable — the Cache-Control middleware setting a header on it threw
    // a TypeError and turned the 302 into a 500.
    const app = createApp();
    const hash = (
      (await (
        await uploadRequest(app, makeFb2(), "x.fb2", {
          contentType: "application/x-fictionbook+xml",
        })
      ).json()) as { book: { contentHash: string } }
    ).book.contentHash;

    // Link it to a catalog entry, leaving coverPath null.
    await db
      .updateTable("personal_book")
      .set({ hiveId: "bk_catalog1" })
      .where("contentHash", "=", hash)
      .execute();

    const res = await app.request(
      `/xrpc/buzz.bookhive.getPersonalBookCover?contentHash=${hash}&width=200`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/images/books/bk_catalog1?w=200");

    // The header guard is the actual regression: mutating it must not throw.
    expect(() => res.headers.set("cache-control", "private, no-store")).not.toThrow();
  });
});

describe("XRPC getPersonalLibrary — search, sort and storage", () => {
  async function seedLibrary(app: TestApp) {
    await uploadRequest(app, makeEpub({ title: "Dune", authors: ["Frank Herbert"] }), "Dune.epub");
    await uploadRequest(
      app,
      makeEpub({ title: "Neuromancer", authors: ["William Gibson"] }),
      "Neuromancer.epub",
    );
    await uploadRequest(
      app,
      makeEpub({ title: "Ancillary Justice", authors: ["Ann Leckie"] }),
      "Ancillary.epub",
    );
  }

  it("filters on title or author, matching the OPDS search feed", async () => {
    const app = createApp();
    await seedLibrary(app);

    const byTitle = (await (
      await app.request("/xrpc/buzz.bookhive.getPersonalLibrary?q=neuro")
    ).json()) as { books: { title: string }[]; total: number };
    expect(byTitle.books.map((b) => b.title)).toEqual(["Neuromancer"]);
    expect(byTitle.total).toBe(1);

    const byAuthor = (await (
      await app.request("/xrpc/buzz.bookhive.getPersonalLibrary?q=Leckie")
    ).json()) as { books: { title: string }[] };
    expect(byAuthor.books.map((b) => b.title)).toEqual(["Ancillary Justice"]);
  });

  it("sorts by title and by author on request", async () => {
    const app = createApp();
    await seedLibrary(app);

    const byTitle = (await (
      await app.request("/xrpc/buzz.bookhive.getPersonalLibrary?sort=title")
    ).json()) as { books: { title: string }[] };
    expect(byTitle.books.map((b) => b.title)).toEqual(["Ancillary Justice", "Dune", "Neuromancer"]);

    const byAuthor = (await (
      await app.request("/xrpc/buzz.bookhive.getPersonalLibrary?sort=author")
    ).json()) as { books: { authors?: string }[] };
    expect(byAuthor.books.map((b) => b.authors)).toEqual([
      "Ann Leckie",
      "Frank Herbert",
      "William Gibson",
    ]);
  });

  it("defaults to newest first, and does not switch when q is set", async () => {
    // Deterministic because every sort ends on `personal_book.id`: all three
    // uploads land in the same whole second, so `createdAt DESC` alone leaves
    // the order up to SQLite. Newest-first therefore means "highest id first",
    // which is the last book seeded.
    const app = createApp();
    await seedLibrary(app);
    const res = (await (await app.request("/xrpc/buzz.bookhive.getPersonalLibrary")).json()) as {
      books: { title: string }[];
    };
    expect(res.books.map((b) => b.title)).toEqual(["Ancillary Justice", "Neuromancer", "Dune"]);

    // OPDS switches to a title sort when searching; this deliberately does not.
    // `q` narrows the set, it does not reorder it.
    const searched = (await (
      await app.request("/xrpc/buzz.bookhive.getPersonalLibrary?q=n")
    ).json()) as { books: { title: string }[] };
    expect(searched.books.map((b) => b.title)).toEqual([
      "Ancillary Justice",
      "Neuromancer",
      "Dune",
    ]);
  });

  it("reports storage usage and the extra view fields", async () => {
    const app = createApp();
    const bytes = makeEpub({ title: "Dune" });
    await uploadRequest(app, bytes, "Dune.epub");

    const res = (await (await app.request("/xrpc/buzz.bookhive.getPersonalLibrary")).json()) as {
      books: { filename: string; hasLocalCover: boolean }[];
      storage: { usedBytes: number; quotaBytes: number };
    };
    expect(res.storage).toEqual({ usedBytes: bytes.length, quotaBytes: getStorageQuota() });
    expect(res.books[0]!.filename).toBe("Dune.epub");
    expect(res.books[0]!.hasLocalCover).toBe(true);
  });
});

describe("XRPC listPersonalShelves", () => {
  it("returns shelves with counts plus library totals", async () => {
    const app = createApp();
    await uploadRequest(app, makeEpub({ title: "Dune" }), "Dune.epub");
    const bookRow = await db.selectFrom("personal_book").select("id").executeTakeFirstOrThrow();

    const shelf = await db
      .insertInto("personal_shelf")
      .values({
        userDid: DID,
        name: "Sci-Fi",
        description: "space",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("personal_shelf_item")
      .values({
        shelfId: shelf.id,
        personalBookId: bookRow.id,
        createdAt: "2026-08-01T00:00:00.000Z",
      })
      .execute();

    const res = (await (await app.request("/xrpc/buzz.bookhive.listPersonalShelves")).json()) as {
      shelves: { id: number; name: string; description?: string; bookCount: number }[];
      totalBooks: number;
      storage: { usedBytes: number; quotaBytes: number };
    };

    expect(res.shelves).toHaveLength(1);
    expect(res.shelves[0]!.name).toBe("Sci-Fi");
    expect(res.shelves[0]!.description).toBe("space");
    expect(res.shelves[0]!.bookCount).toBe(1);
    expect(res.totalBooks).toBe(1);
    expect(res.storage.quotaBytes).toBe(getStorageQuota());
  });

  it("does not show another user's shelves", async () => {
    await db
      .insertInto("personal_shelf")
      .values({
        userDid: OTHER_DID,
        name: "Theirs",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })
      .execute();

    const res = (await (
      await createApp(DID).request("/xrpc/buzz.bookhive.listPersonalShelves")
    ).json()) as { shelves: unknown[]; totalBooks: number };
    expect(res.shelves).toHaveLength(0);
    expect(res.totalBooks).toBe(0);
  });

  it("401s without a session", async () => {
    const res = await createApp(null).request("/xrpc/buzz.bookhive.listPersonalShelves");
    expect(res.status).toBe(401);
  });
});
