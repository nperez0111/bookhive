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
import opdsRouter from "./opds";

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
  },
) {
  const inserted = await db
    .insertInto("personal_book")
    .values({
      userDid: DID,
      contentHash: opts.contentHash,
      hiveId: opts.hiveId ?? null,
      filename: `${opts.contentHash}.epub`,
      title: opts.title ?? "A Personal Book",
      authors: opts.authors === undefined ? "An Author" : opts.authors,
      language: opts.language ?? "en",
      format: "epub",
      mime: "application/epub+zip",
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
    expect(acq.href).toContain("/opds/books/hash-a/download");
    expect(acq.type).toBe("application/epub+zip");
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
});
