import { Hono } from "hono";
import type { AppEnv } from "../context";
import { opdsAuthMiddleware } from "../middleware/opds-auth";
import { escapeXml } from "../utils/xml";
import { OPDS_PAGE_SIZE } from "../utils/personalLibrary";
import type { Selectable } from "kysely";
import type { PersonalBookRow } from "../types";

// OPDS 1.2 Atom feed content types
const OPDS_NAV_TYPE = "application/atom+xml;profile=opds-catalog;kind=navigation";
const OPDS_ACQ_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";

type OpdsEnv = AppEnv & { Variables: { opdsUserDid: string } };

type BookForEntry = Selectable<PersonalBookRow> & {
  hiveBookCover?: string | null;
  hiveBookDescription?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestOrigin(c: {
  req: { header: (n: string) => string | undefined; url: string };
}): string {
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(c.req.url).protocol.replace(":", "");
  const host =
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() ||
    c.req.header("host") ||
    new URL(c.req.url).host;
  return `${proto}://${host}`;
}

function isoDate(d: string | number | Date): string {
  return new Date(d).toISOString();
}

function parsePage(c: { req: { query: (n: string) => string | undefined } }): number {
  const raw = Number(c.req.query("page"));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Build an OPDS acquisition entry for a personal library book. */
function opdsEntry(origin: string, book: BookForEntry): string {
  const id = `urn:bookhive:book:${book.contentHash}`;
  const updated = isoDate(book.updatedAt);

  const author = book.authors ? `<author><name>${escapeXml(book.authors)}</name></author>` : "";

  const lang = book.language
    ? `<dcterms:language>${escapeXml(book.language)}</dcterms:language>`
    : "";

  // Summary from linked hive book description
  const summary = book.hiveBookDescription
    ? `<summary type="text">${escapeXml(book.hiveBookDescription)}</summary>`
    : "";

  // Cover links: prefer local cover, fall back to hive book cover
  let coverLinks = "";
  if (book.coverPath) {
    const coverType = escapeXml(book.coverMime || "image/jpeg");
    coverLinks =
      `<link rel="http://opds-spec.org/image" href="${origin}/opds/books/${book.contentHash}/cover" type="${coverType}"/>` +
      `<link rel="http://opds-spec.org/image/thumbnail" href="${origin}/opds/books/${book.contentHash}/cover" type="${coverType}"/>`;
  } else if (book.hiveId) {
    coverLinks =
      `<link rel="http://opds-spec.org/image" href="${origin}/opds/books/${book.contentHash}/cover" type="image/jpeg"/>` +
      `<link rel="http://opds-spec.org/image/thumbnail" href="${origin}/opds/books/${book.contentHash}/cover" type="image/jpeg"/>`;
  }

  return (
    `<entry>` +
    `<title>${escapeXml(book.title)}</title>` +
    `<id>${id}</id>` +
    `<updated>${updated}</updated>` +
    author +
    lang +
    summary +
    coverLinks +
    `<link rel="http://opds-spec.org/acquisition" href="${origin}/opds/books/${book.contentHash}/download" type="${escapeXml(book.mime || "application/epub+zip")}"/>` +
    `</entry>`
  );
}

/** Build a complete paginated OPDS acquisition feed. */
function opdsAcquisitionFeed(
  origin: string,
  opts: {
    feedId: string;
    title: string;
    selfPath: string;
    books: BookForEntry[];
    page: number;
    totalPages: number;
  },
): string {
  const { feedId, title, selfPath, books, page, totalPages } = opts;
  const pageLink = (p: number) =>
    `${origin}${selfPath}${selfPath.includes("?") ? "&" : "?"}page=${p}`;

  let links =
    `<link rel="self" href="${origin}${selfPath}" type="${OPDS_ACQ_TYPE}"/>` +
    `<link rel="start" href="${origin}/opds" type="${OPDS_NAV_TYPE}"/>` +
    `<link rel="up" href="${origin}/opds" type="${OPDS_NAV_TYPE}"/>` +
    `<link rel="search" href="${origin}/opds/search" type="application/opensearchdescription+xml"/>`;
  if (totalPages > 1) {
    links += `<link rel="first" href="${pageLink(1)}" type="${OPDS_ACQ_TYPE}"/>`;
    links += `<link rel="last" href="${pageLink(totalPages)}" type="${OPDS_ACQ_TYPE}"/>`;
    if (page > 1)
      links += `<link rel="previous" href="${pageLink(page - 1)}" type="${OPDS_ACQ_TYPE}"/>`;
    if (page < totalPages)
      links += `<link rel="next" href="${pageLink(page + 1)}" type="${OPDS_ACQ_TYPE}"/>`;
  }

  const entries = books.map((b) => opdsEntry(origin, b)).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">` +
    `<id>${feedId}</id>` +
    `<title>${escapeXml(title)}</title>` +
    `<updated>${isoDate(Date.now())}</updated>` +
    links +
    entries +
    `</feed>`
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono<OpdsEnv>();

app.use("*", opdsAuthMiddleware);

// GET / — Root navigation feed
app.get("/", (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const origin = requestOrigin(c);
  const now = isoDate(Date.now());

  const navEntry = (id: string, title: string, href: string) =>
    `<entry><title>${escapeXml(title)}</title><id>${id}</id>` +
    `<updated>${now}</updated>` +
    `<link rel="subsection" href="${href}" type="${OPDS_ACQ_TYPE}"/>` +
    `</entry>`;

  return db
    .selectFrom("personal_shelf")
    .select(["id", "name"])
    .where("userDid", "=", userDid)
    .orderBy("name", "asc")
    .execute()
    .then((shelves) => {
      let entries = navEntry("urn:bookhive:all", "All Books", `${origin}/opds/all`);
      for (const shelf of shelves) {
        entries += navEntry(
          `urn:bookhive:shelf:${shelf.id}`,
          shelf.name,
          `${origin}/opds/shelves/${shelf.id}`,
        );
      }

      const feed =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">` +
        `<id>urn:bookhive:opds:root</id>` +
        `<title>BookHive Library</title>` +
        `<updated>${now}</updated>` +
        `<link rel="self" href="${origin}/opds" type="${OPDS_NAV_TYPE}"/>` +
        `<link rel="start" href="${origin}/opds" type="${OPDS_NAV_TYPE}"/>` +
        `<link rel="search" href="${origin}/opds/search" type="application/opensearchdescription+xml"/>` +
        entries +
        `</feed>`;

      return c.body(feed, 200, { "Content-Type": OPDS_NAV_TYPE });
    });
});

// GET /all — Acquisition feed: all books
app.get("/all", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const origin = requestOrigin(c);
  const page = parsePage(c);

  const { total } = await db
    .selectFrom("personal_book")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("userDid", "=", userDid)
    .executeTakeFirstOrThrow();

  const totalPages = Math.max(1, Math.ceil(total / OPDS_PAGE_SIZE));

  const books = await db
    .selectFrom("personal_book")
    .leftJoin("hive_book", "hive_book.id", "personal_book.hiveId")
    .select([
      "personal_book.id",
      "personal_book.userDid",
      "personal_book.contentHash",
      "personal_book.hiveId",
      "personal_book.filename",
      "personal_book.title",
      "personal_book.authors",
      "personal_book.language",
      "personal_book.format",
      "personal_book.mime",
      "personal_book.filePath",
      "personal_book.coverPath",
      "personal_book.coverMime",
      "personal_book.sizeBytes",
      "personal_book.createdAt",
      "personal_book.updatedAt",
      "hive_book.cover as hiveBookCover",
      "hive_book.description as hiveBookDescription",
    ])
    .where("personal_book.userDid", "=", userDid)
    .orderBy("personal_book.createdAt", "desc")
    .limit(OPDS_PAGE_SIZE)
    .offset((page - 1) * OPDS_PAGE_SIZE)
    .execute();

  const feed = opdsAcquisitionFeed(origin, {
    feedId: "urn:bookhive:all",
    title: "All Books",
    selfPath: "/opds/all",
    books,
    page,
    totalPages,
  });
  return c.body(feed, 200, { "Content-Type": OPDS_ACQ_TYPE });
});

// GET /shelves/:id — Acquisition feed: books on a shelf
app.get("/shelves/:id", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const origin = requestOrigin(c);
  const shelfId = Number(c.req.param("id"));

  if (!Number.isInteger(shelfId)) {
    return c.body("Not found", 404);
  }

  const shelf = await db
    .selectFrom("personal_shelf")
    .select(["id", "name"])
    .where("id", "=", shelfId)
    .where("userDid", "=", userDid)
    .executeTakeFirst();

  if (!shelf) {
    return c.body("Not found", 404);
  }

  const page = parsePage(c);

  const { total } = await db
    .selectFrom("personal_shelf_item")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("shelfId", "=", shelfId)
    .executeTakeFirstOrThrow();

  const totalPages = Math.max(1, Math.ceil(total / OPDS_PAGE_SIZE));

  const books = await db
    .selectFrom("personal_shelf_item")
    .innerJoin("personal_book", "personal_book.id", "personal_shelf_item.personalBookId")
    .leftJoin("hive_book", "hive_book.id", "personal_book.hiveId")
    .select([
      "personal_book.id",
      "personal_book.userDid",
      "personal_book.contentHash",
      "personal_book.hiveId",
      "personal_book.filename",
      "personal_book.title",
      "personal_book.authors",
      "personal_book.language",
      "personal_book.format",
      "personal_book.mime",
      "personal_book.filePath",
      "personal_book.coverPath",
      "personal_book.coverMime",
      "personal_book.sizeBytes",
      "personal_book.createdAt",
      "personal_book.updatedAt",
      "hive_book.cover as hiveBookCover",
      "hive_book.description as hiveBookDescription",
    ])
    .where("personal_shelf_item.shelfId", "=", shelfId)
    .where("personal_book.userDid", "=", userDid)
    .orderBy("personal_book.createdAt", "desc")
    .limit(OPDS_PAGE_SIZE)
    .offset((page - 1) * OPDS_PAGE_SIZE)
    .execute();

  const feed = opdsAcquisitionFeed(origin, {
    feedId: `urn:bookhive:shelf:${shelfId}`,
    title: shelf.name,
    selfPath: `/opds/shelves/${shelfId}`,
    books,
    page,
    totalPages,
  });
  return c.body(feed, 200, { "Content-Type": OPDS_ACQ_TYPE });
});

// GET /books/:hash/download — Stream book file
app.get("/books/:hash/download", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const hash = c.req.param("hash");

  const book = await db
    .selectFrom("personal_book")
    .select(["filePath", "filename", "mime", "format"])
    .where("userDid", "=", userDid)
    .where("contentHash", "=", hash)
    .executeTakeFirst();

  if (!book) {
    return c.body("Not found", 404);
  }

  const file = Bun.file(book.filePath);
  if (!(await file.exists())) {
    return c.body("Not found", 404);
  }

  const downloadName = book.filename.toLowerCase().includes(".")
    ? book.filename
    : `${book.filename}.${book.format || "epub"}`;

  return c.body(file.stream(), 200, {
    "Content-Type": book.mime || "application/epub+zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  });
});

// GET /books/:hash/cover — Serve cover image
app.get("/books/:hash/cover", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const hash = c.req.param("hash");

  const book = await db
    .selectFrom("personal_book")
    .select(["coverPath", "coverMime", "hiveId"])
    .where("userDid", "=", userDid)
    .where("contentHash", "=", hash)
    .executeTakeFirst();

  if (!book) {
    return c.body("Not found", 404);
  }

  // Local cover file
  if (book.coverPath) {
    const file = Bun.file(book.coverPath);
    if (await file.exists()) {
      return c.body(file.stream(), 200, {
        "Content-Type": book.coverMime || "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      });
    }
  }

  // Fall back to hive book cover via image proxy
  if (book.hiveId) {
    return c.redirect(`/images/books/${book.hiveId}?w=300`, 302);
  }

  return c.body("Not found", 404);
});

// GET /search — OpenSearch description document
app.get("/search", (c) => {
  const origin = requestOrigin(c);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">` +
    `<ShortName>BookHive</ShortName>` +
    `<Description>Search your BookHive personal library</Description>` +
    `<Url type="${OPDS_ACQ_TYPE}" template="${origin}/opds/search/results?q={searchTerms}"/>` +
    `<InputEncoding>UTF-8</InputEncoding>` +
    `<OutputEncoding>UTF-8</OutputEncoding>` +
    `</OpenSearchDescription>`;
  return c.body(xml, 200, {
    "Content-Type": "application/opensearchdescription+xml",
  });
});

// GET /search/results — Search results acquisition feed
app.get("/search/results", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const origin = requestOrigin(c);
  const q = c.req.query("q")?.trim();

  if (!q) {
    const feed = opdsAcquisitionFeed(origin, {
      feedId: "urn:bookhive:search",
      title: "Search Results",
      selfPath: "/opds/search/results",
      books: [],
      page: 1,
      totalPages: 1,
    });
    return c.body(feed, 200, { "Content-Type": OPDS_ACQ_TYPE });
  }

  const page = parsePage(c);
  const likePattern = `%${q}%`;

  const { total } = await db
    .selectFrom("personal_book")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("userDid", "=", userDid)
    .where((eb) => eb.or([eb("title", "like", likePattern), eb("authors", "like", likePattern)]))
    .executeTakeFirstOrThrow();

  const totalPages = Math.max(1, Math.ceil(total / OPDS_PAGE_SIZE));

  const books = await db
    .selectFrom("personal_book")
    .leftJoin("hive_book", "hive_book.id", "personal_book.hiveId")
    .select([
      "personal_book.id",
      "personal_book.userDid",
      "personal_book.contentHash",
      "personal_book.hiveId",
      "personal_book.filename",
      "personal_book.title",
      "personal_book.authors",
      "personal_book.language",
      "personal_book.format",
      "personal_book.mime",
      "personal_book.filePath",
      "personal_book.coverPath",
      "personal_book.coverMime",
      "personal_book.sizeBytes",
      "personal_book.createdAt",
      "personal_book.updatedAt",
      "hive_book.cover as hiveBookCover",
      "hive_book.description as hiveBookDescription",
    ])
    .where("personal_book.userDid", "=", userDid)
    .where((eb) =>
      eb.or([
        eb("personal_book.title", "like", likePattern),
        eb("personal_book.authors", "like", likePattern),
      ]),
    )
    .orderBy("personal_book.title", "asc")
    .limit(OPDS_PAGE_SIZE)
    .offset((page - 1) * OPDS_PAGE_SIZE)
    .execute();

  const selfPath = `/opds/search/results?q=${encodeURIComponent(q)}`;
  const feed = opdsAcquisitionFeed(origin, {
    feedId: `urn:bookhive:search:${encodeURIComponent(q)}`,
    title: `Search: ${q}`,
    selfPath,
    books,
    page,
    totalPages,
  });
  return c.body(feed, 200, { "Content-Type": OPDS_ACQ_TYPE });
});

export default app;
