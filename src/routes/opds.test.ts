import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { AppContext, AppEnv } from "../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import { currentSyncPassword } from "../middleware/sync-auth";
import type { HiveId } from "../types";
import opdsRouter, { downloadOrigin } from "./opds";

const DID = "did:plc:testuser";
const HANDLE = "test.bsky.social";

// KOReader sends this exact header (koreader/koreader#15696, fixed in #15751).
const KOREADER_ACCEPT = "application/opds+json, application/atom+xml;profile=opds-catalog, */*";

const now = "2026-07-29T12:00:00.000Z";

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

const kv = createStorage({ driver: memoryDriver() });

/** Collects whatever the routes put on the wide event for the last request. */
const wideEvent: Record<string, unknown> = {};

function createApp(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db,
      kv,
      baseIdResolver: {
        handle: { resolve: async (h: string) => (h === HANDLE ? DID : null) },
      },
      addWideEventContext: (fields: Record<string, unknown>) => Object.assign(wideEvent, fields),
    } as unknown as AppContext);
    await next();
  });
  app.route("/opds", opdsRouter);
  return app;
}

/** Basic-auth header for the seeded user, derived the same way the app does. */
async function authHeader(): Promise<string> {
  const password = await currentSyncPassword(kv, DID);
  return `Basic ${Buffer.from(`${HANDLE}:${password}`).toString("base64")}`;
}

async function seedBook(
  db: Database,
  opts: {
    contentHash: string;
    title?: string;
    authors?: string | null;
    hiveId?: HiveId | null;
    coverPath?: string | null;
    language?: string | null;
    format?: string;
    mime?: string;
    filename?: string;
  },
) {
  const inserted = await db
    .insertInto("personal_book")
    .values({
      userDid: DID,
      contentHash: opts.contentHash,
      hiveId: opts.hiveId ?? null,
      filename: opts.filename ?? `${opts.contentHash}.epub`,
      title: opts.title ?? "A Personal Book",
      authors: opts.authors === undefined ? "An Author" : opts.authors,
      language: opts.language ?? "en",
      format: opts.format ?? "epub",
      mime: opts.mime ?? "application/epub+zip",
      filePath: `/tmp/${opts.contentHash}.epub`,
      coverPath: opts.coverPath ?? null,
      coverMime: opts.coverPath ? "image/jpeg" : null,
      sizeBytes: 1234,
      createdAt: now,
      updatedAt: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function seedShelf(db: Database, name: string, bookIds: number[] = []) {
  const shelf = await db
    .insertInto("personal_shelf")
    .values({ userDid: DID, name, description: null, createdAt: now, updatedAt: now })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const personalBookId of bookIds) {
    await db
      .insertInto("personal_shelf_item")
      .values({ shelfId: shelf.id, personalBookId, createdAt: now })
      .execute();
  }
  return shelf.id;
}

describe("OPDS 2.0 content negotiation", () => {
  let db: Database;
  let app: Hono<AppEnv>;
  let auth: string;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
    auth = await authHeader();
    for (const k of Object.keys(wideEvent)) delete wideEvent[k];
  });

  it("records the negotiated format on the wide event", async () => {
    // A silent fallback to Atom still renders fine, so the logs need to say
    // which format actually went out.
    await app.request("/opds", { headers: { authorization: auth, accept: KOREADER_ACCEPT } });
    expect(wideEvent["opds_format"]).toBe("2.0");

    await app.request("/opds", { headers: { authorization: auth } });
    expect(wideEvent["opds_format"]).toBe("1.2");
  });

  it("serves Atom XML when the client does not ask for OPDS 2.0", async () => {
    const res = await app.request("/opds", { headers: { authorization: auth } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/atom+xml");
    const body = await res.text();
    // KOReader picks its parser from the first byte.
    expect(body.trimStart().startsWith("<")).toBe(true);
  });

  it("serves a JSON navigation feed when the client asks for OPDS 2.0", async () => {
    await seedBook(db, { contentHash: "hash-a" });
    await seedShelf(db, "Sci-Fi");

    const res = await app.request("/opds", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/opds+json");

    const body = await res.json();
    expect(body.metadata.title).toBe("BookHive Library");
    expect(body.navigation.map((n: { title: string }) => n.title)).toEqual(["All Books", "Sci-Fi"]);
    // KOReader renders these counts beside each entry.
    expect(body.navigation[0].properties.numberOfItems).toBe(1);
    expect(body.navigation[1].properties.numberOfItems).toBe(0);

    const search = body.links.find((l: { rel: string }) => l.rel === "search");
    // KOReader rewrites this template to `...?query=%s`; see opds2SearchLink.
    expect(search.href).toContain("/opds/search/results?query={query}");
    expect(search.templated).toBe(true);
  });

  it("reports per-shelf counts in the navigation feed", async () => {
    const a = await seedBook(db, { contentHash: "hash-a" });
    const b = await seedBook(db, { contentHash: "hash-b" });
    await seedBook(db, { contentHash: "hash-c" });
    await seedShelf(db, "Sci-Fi", [a, b]);

    const res = await app.request("/opds", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.navigation[0].properties.numberOfItems).toBe(3);
    expect(body.navigation[1].properties.numberOfItems).toBe(2);
  });

  it("serves publications with the metadata and rels KOReader reads", async () => {
    await seedBook(db, {
      contentHash: "hash-a",
      title: "Dune",
      authors: "Frank Herbert",
      coverPath: "/tmp/cover.jpg",
    });

    const res = await app.request("/opds/all", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();

    expect(body.metadata.title).toBe("All Books");
    expect(body.metadata.numberOfItems).toBe(1);
    expect(body.metadata.currentPage).toBe(1);

    const pub = body.publications[0];
    expect(pub.metadata.title).toBe("Dune");
    expect(pub.metadata.author).toEqual({ name: "Frank Herbert" });
    expect(pub.metadata.language).toBe("en");

    // KOReader matches these exact rel strings.
    expect(pub.images.map((i: { rel: string }) => i.rel)).toEqual([
      "http://opds-spec.org/image",
      "http://opds-spec.org/image/thumbnail",
    ]);
    const acq = pub.links.find((l: { rel: string }) =>
      l.rel.startsWith("http://opds-spec.org/acquisition"),
    );
    // The extension is decoration for us and load-bearing for the client:
    // CrossPoint's parser prefers an acquisition href containing ".epub" and
    // Kobo's browser dispatches on it alone.
    expect(acq.href).toContain("/opds/books/hash-a/download/hash-a.epub");
    expect(acq.rel).toBe("http://opds-spec.org/acquisition/open-access");
    expect(acq.type).toBe("application/epub+zip");
    // OPDS_DOWNLOAD_BASE_URL is unset here, so the download stays on the
    // origin the feed itself was served from.
    const self = body.links.find((l: { rel: string }) => l.rel === "self");
    expect(acq.href.startsWith(new URL(self.href).origin)).toBe(true);
  });

  it("omits images for a book with no cover and no hive book", async () => {
    await seedBook(db, { contentHash: "hash-a", coverPath: null, hiveId: null });
    const res = await app.request("/opds/all", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.publications[0].images).toBeUndefined();
  });

  it("omits the author field when the book has no authors", async () => {
    await seedBook(db, { contentHash: "hash-a", authors: null });
    const res = await app.request("/opds/all", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.publications[0].metadata.author).toBeUndefined();
  });

  it("emits next/previous pagination links across pages", async () => {
    // OPDS_PAGE_SIZE is 24, so 30 books spans two pages.
    for (let i = 0; i < 30; i++) {
      await seedBook(db, { contentHash: `hash-${i}` });
    }

    const first = await (
      await app.request("/opds/all", {
        headers: { authorization: auth, accept: KOREADER_ACCEPT },
      })
    ).json();
    expect(first.publications).toHaveLength(24);
    expect(first.metadata.numberOfItems).toBe(30);
    const rels = first.links.map((l: { rel: string }) => l.rel);
    expect(rels).toContain("next");
    expect(rels).not.toContain("previous");

    const second = await (
      await app.request("/opds/all?page=2", {
        headers: { authorization: auth, accept: KOREADER_ACCEPT },
      })
    ).json();
    expect(second.publications).toHaveLength(6);
    expect(second.metadata.currentPage).toBe(2);
    const rels2 = second.links.map((l: { rel: string }) => l.rel);
    expect(rels2).toContain("previous");
    expect(rels2).not.toContain("next");
  });

  it("serves a shelf as a JSON acquisition feed", async () => {
    const a = await seedBook(db, { contentHash: "hash-a", title: "On Shelf" });
    await seedBook(db, { contentHash: "hash-b", title: "Off Shelf" });
    const shelfId = await seedShelf(db, "Sci-Fi", [a]);

    const res = await app.request(`/opds/shelves/${shelfId}`, {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.metadata.title).toBe("Sci-Fi");
    expect(body.metadata.numberOfItems).toBe(1);
    expect(body.publications).toHaveLength(1);
    expect(body.publications[0].metadata.title).toBe("On Shelf");
  });

  it("searches via the `query` param the OPDS 2.0 template expands to", async () => {
    await seedBook(db, { contentHash: "hash-a", title: "Dune" });
    await seedBook(db, { contentHash: "hash-b", title: "Neuromancer" });

    const res = await app.request("/opds/search/results?query=Dune", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.publications).toHaveLength(1);
    expect(body.publications[0].metadata.title).toBe("Dune");
  });

  it("still accepts the OpenSearch `q` param", async () => {
    await seedBook(db, { contentHash: "hash-a", title: "Dune" });

    const res = await app.request("/opds/search/results?q=Dune", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    const body = await res.json();
    expect(body.publications).toHaveLength(1);
  });

  it("returns an empty JSON feed for a blank search", async () => {
    const res = await app.request("/opds/search/results", {
      headers: { authorization: auth, accept: KOREADER_ACCEPT },
    });
    expect(res.headers.get("content-type")).toContain("application/opds+json");
    const body = await res.json();
    expect(body.publications).toEqual([]);
    expect(body.metadata.numberOfItems).toBe(0);
  });

  it("still requires authentication for OPDS 2.0 requests", async () => {
    const res = await app.request("/opds", { headers: { accept: KOREADER_ACCEPT } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  describe("cover caching", () => {
    // This route sits under `/opds/books/`, which is excluded from hono's
    // etag() middleware, so if it doesn't set a validator itself it cannot ever
    // answer a conditional request. It didn't: production served 43 cover
    // fetches in 48h and never once returned a 304, while a catalogue browse
    // re-requests every cover on the page.
    const coverPath = "/tmp/bookhive-opds-cover-test.jpg";

    beforeEach(async () => {
      await Bun.write(coverPath, "not-really-a-jpeg-but-bytes-are-bytes");
      await seedBook(db, { contentHash: "hash-a", coverPath });
    });

    it("serves the cover with a strong ETag", async () => {
      const res = await app.request("/opds/books/hash-a/cover", {
        headers: { authorization: auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toBe('"hash-a-cover"');
    });

    it("answers a matching If-None-Match with 304 and no body", async () => {
      const res = await app.request("/opds/books/hash-a/cover", {
        headers: { authorization: auth, "if-none-match": '"hash-a-cover"' },
      });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("still serves the bytes when the validator does not match", async () => {
      const res = await app.request("/opds/books/hash-a/cover", {
        headers: { authorization: auth, "if-none-match": '"something-else"' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("acquisition links", () => {
    it("emits the open-access rel and an extension in the 1.2 feed", async () => {
      await seedBook(db, { contentHash: "hash-a", format: "epub" });
      const res = await app.request("/opds/all", { headers: { authorization: auth } });
      const xml = await res.text();
      expect(xml).toContain('rel="http://opds-spec.org/acquisition/open-access"');
      expect(xml).toContain("/opds/books/hash-a/download/hash-a.epub");
    });

    it("advertises the derived EPUB's type and extension, not the original's", async () => {
      // CrossPoint's parser requires type == "application/epub+zip" exactly, so
      // a MOBI entry is invisible to it until the feed points at the EPUB.
      await seedBook(db, {
        contentHash: "hash-m",
        filename: "Dune.mobi",
        format: "mobi",
        mime: "application/x-mobipocket-ebook",
      });
      await db
        .updateTable("personal_book")
        .set({ epubPath: "/tmp/hash-m.epub", epubSizeBytes: 10 })
        .where("contentHash", "=", "hash-m")
        .execute();

      const xml = await (
        await app.request("/opds/all", { headers: { authorization: auth } })
      ).text();
      expect(xml).toContain('type="application/epub+zip"');
      expect(xml).not.toContain("x-mobipocket");
      expect(xml).toContain("/opds/books/hash-m/download/Dune.epub");
    });

    it("still advertises the original format when nothing was derived", async () => {
      await seedBook(db, {
        contentHash: "hash-m2",
        filename: "Dune.mobi",
        format: "mobi",
        mime: "application/x-mobipocket-ebook",
      });
      const xml = await (
        await app.request("/opds/all", { headers: { authorization: auth } })
      ).text();
      expect(xml).toContain('type="application/x-mobipocket-ebook"');
      expect(xml).toContain("/opds/books/hash-m2/download/Dune.mobi");
    });

    it("uses the book's own format for the extension", async () => {
      await seedBook(db, {
        contentHash: "hash-b",
        format: "cbz",
        mime: "application/vnd.comicbook+zip",
      });
      const xml = await (
        await app.request("/opds/all", { headers: { authorization: auth } })
      ).text();
      expect(xml).toContain("/opds/books/hash-b/download/hash-b.cbz");
    });

    it("puts a canonicalized version of the user's own filename in the URL", async () => {
      await seedBook(db, {
        contentHash: "hash-c",
        filename: "The Handmaid's Tale (Anniversary Ed.).epub",
      });
      const xml = await (
        await app.request("/opds/all", { headers: { authorization: auth } })
      ).text();
      // No apostrophe, no parens, no spaces — nothing needing percent-encoding.
      expect(xml).toContain("/opds/books/hash-c/download/The_Handmaid_s_Tale_Anniversary_Ed.epub");
    });

    it("serves the file at the URL the feed advertises", async () => {
      await seedBook(db, { contentHash: "hash-a" });
      await Bun.write("/tmp/hash-a.epub", "epub bytes");
      const res = await app.request("/opds/books/hash-a/download/hash-a.epub", {
        headers: { authorization: auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("accept-ranges")).toBe("bytes");
    });

    it("ignores the trailing name — the hash is what identifies the file", async () => {
      await seedBook(db, { contentHash: "hash-a" });
      await Bun.write("/tmp/hash-a.epub", "epub bytes");
      const res = await app.request("/opds/books/hash-a/download/anything-at-all.epub", {
        headers: { authorization: auth },
      });
      expect(res.status).toBe(200);
    });

    it("no longer answers the name-less download URL", async () => {
      await seedBook(db, { contentHash: "hash-a" });
      const res = await app.request("/opds/books/hash-a/download", {
        headers: { authorization: auth },
      });
      expect(res.status).toBe(404);
    });

    it("answers a Range request with a 206 over HTTP", async () => {
      await seedBook(db, { contentHash: "hash-a" });
      await Bun.write("/tmp/hash-a.epub", "epub bytes");
      const res = await app.request("/opds/books/hash-a/download/hash-a.epub", {
        headers: { authorization: auth, range: "bytes=0-3" },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toMatch(/^bytes 0-3\/\d+$/);
    });
  });
});

describe("downloadOrigin", () => {
  it("falls back to the request origin when OPDS_DOWNLOAD_BASE_URL is unset", () => {
    expect(downloadOrigin("https://bookhive.buzz", "")).toBe("https://bookhive.buzz");
    expect(downloadOrigin("https://bookhive.buzz", "   ")).toBe("https://bookhive.buzz");
  });

  it("replaces the scheme+host when configured, leaving the path to the caller", () => {
    expect(downloadOrigin("https://bookhive.buzz", "https://dl.bookhive.buzz")).toBe(
      "https://dl.bookhive.buzz",
    );
  });

  it("trims a trailing slash so the joined path never doubles up", () => {
    expect(downloadOrigin("https://bookhive.buzz", "https://dl.bookhive.buzz/")).toBe(
      "https://dl.bookhive.buzz",
    );
  });
});
