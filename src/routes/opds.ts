import { Hono, type Context } from "hono";
import type { AppEnv } from "../context";
import { opdsAuthMiddleware } from "../middleware/opds-auth";
import { env } from "../env";
import { escapeXml } from "../lib/xml";
import {
  etagMatches,
  OPDS_PAGE_SIZE,
  servedRepresentation,
  streamPersonalBook,
} from "../data/personalLibrary";
import { canonicalDownloadFilename } from "../core/downloadFilename";
import { calculatePagination, pageOffset } from "../lib/pagination";
import { listPersonalBooks, type PersonalBookRowWithHive } from "../data/personalBooks";

const OPDS_NAV_TYPE = "application/atom+xml;profile=opds-catalog;kind=navigation";
const OPDS_ACQ_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";

// OPDS 2.0 JSON feed content type (https://specs.opds.io/opds-2.0.html)
const OPDS2_TYPE = "application/opds+json";

// The bare `.../acquisition` relation is generic and lets a strict reader wait
// forever for an indirectAcquisition that never comes; every client accepting
// the generic form also matches this one via prefix match.
const ACQUISITION_REL = "http://opds-spec.org/acquisition/open-access";
const IMAGE_REL = "http://opds-spec.org/image";
const THUMBNAIL_REL = "http://opds-spec.org/image/thumbnail";

type OpdsEnv = AppEnv & { Variables: { opdsUserDid: string } };

// The data layer's row type — shared by the three acquisition feeds and the
// four XRPC methods so there's one column list, not two kept in sync by hand.
type BookForEntry = PersonalBookRowWithHive;

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

/**
 * Origin for acquisition (download) links only — feed links stay on the host
 * the reader asked for, but the file transfer can be pointed at an origin that
 * reaches this app directly, bypassing whatever proxy fronts the public host.
 *
 * `configured` is a parameter, not read inline, because envalid freezes `env`
 * at import and tests can't set it.
 */
export function downloadOrigin(
  origin: string,
  configured: string = env.OPDS_DOWNLOAD_BASE_URL,
): string {
  const base = configured.trim().replace(/\/+$/, "");
  return base || origin;
}

/**
 * Acquisition URL for a book: `.../books/{hash}/download/{Canonical_Name}.epub`.
 * Everything after `/download/` is decoration for us — the content hash
 * identifies the file — but readers like CrossPoint and Kobo dispatch on the
 * URL's extension rather than the Content-Type, so the name must look real.
 * It's the canonical ASCII form of what the user uploaded, so it needs no
 * percent-encoding and matches `Content-Disposition`'s `filename` byte for byte.
 */
function acquisitionHref(origin: string, book: BookForEntry): string {
  const name = canonicalDownloadFilename(book.filename, servedRepresentation(book).format);
  return `${downloadOrigin(origin)}/opds/books/${book.contentHash}/download/${name}`;
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
    `<link rel="${ACQUISITION_REL}" href="${escapeXml(acquisitionHref(origin, book))}" type="${escapeXml(servedRepresentation(book).mime)}"/>` +
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
// OPDS 2.0 (JSON) builders
//
// KOReader picks its parser from the first byte of the response body: `{` is
// OPDS 2.0, `<` is OPDS 1.x. The two formats are just two renderings of the
// same query.
// ---------------------------------------------------------------------------

type Opds2Link = {
  rel: string;
  href: string;
  type: string;
  title?: string;
  templated?: boolean;
  properties?: { numberOfItems?: number };
};

function wantsOpds2(c: { req: { header: (n: string) => string | undefined } }): boolean {
  return (c.req.header("accept") || "").toLowerCase().includes(OPDS2_TYPE);
}

// Picks the feed format and records it on the wide event — a silent fallback
// to Atom renders fine, so it's otherwise indistinguishable from a real 2.0
// negotiation.
function negotiateFeedFormat(c: Context<OpdsEnv>): boolean {
  const opds2 = wantsOpds2(c);
  c.get("ctx").addWideEventContext({ opds_format: opds2 ? "2.0" : "1.2" });
  return opds2;
}

// Spelled `?query={query}` rather than `{?query}` — KOReader's Lua template
// expansion only handles the plain form.
function opds2SearchLink(origin: string): Opds2Link {
  return {
    rel: "search",
    href: `${origin}/opds/search/results?query={query}`,
    type: OPDS2_TYPE,
    templated: true,
  };
}

/** Build an OPDS 2.0 Publication object for a personal library book. */
function opds2Publication(origin: string, book: BookForEntry) {
  const images: Opds2Link[] = [];
  if (book.coverPath || book.hiveId) {
    const href = `${origin}/opds/books/${book.contentHash}/cover`;
    const type = book.coverPath ? book.coverMime || "image/jpeg" : "image/jpeg";
    images.push({ rel: IMAGE_REL, href, type }, { rel: THUMBNAIL_REL, href, type });
  }

  return {
    metadata: {
      "@type": "http://schema.org/Book",
      identifier: `urn:bookhive:book:${book.contentHash}`,
      title: book.title,
      ...(book.authors ? { author: { name: book.authors } } : {}),
      ...(book.language ? { language: book.language } : {}),
      ...(book.hiveBookDescription ? { description: book.hiveBookDescription } : {}),
      modified: isoDate(book.updatedAt),
    },
    ...(images.length ? { images } : {}),
    links: [
      {
        rel: ACQUISITION_REL,
        href: acquisitionHref(origin, book),
        type: servedRepresentation(book).mime,
      },
    ],
  };
}

/** Build a complete paginated OPDS 2.0 acquisition feed. */
function opds2AcquisitionFeed(
  origin: string,
  opts: {
    title: string;
    selfPath: string;
    books: BookForEntry[];
    page: number;
    totalPages: number;
    total: number;
  },
) {
  const { title, selfPath, books, page, totalPages, total } = opts;
  const pageLink = (p: number) =>
    `${origin}${selfPath}${selfPath.includes("?") ? "&" : "?"}page=${p}`;

  const links: Opds2Link[] = [
    { rel: "self", href: `${origin}${selfPath}`, type: OPDS2_TYPE },
    { rel: "start", href: `${origin}/opds`, type: OPDS2_TYPE },
    opds2SearchLink(origin),
  ];
  if (totalPages > 1) {
    links.push({ rel: "first", href: pageLink(1), type: OPDS2_TYPE });
    links.push({ rel: "last", href: pageLink(totalPages), type: OPDS2_TYPE });
    if (page > 1) links.push({ rel: "previous", href: pageLink(page - 1), type: OPDS2_TYPE });
    if (page < totalPages) links.push({ rel: "next", href: pageLink(page + 1), type: OPDS2_TYPE });
  }

  return {
    metadata: {
      title,
      numberOfItems: total,
      itemsPerPage: OPDS_PAGE_SIZE,
      currentPage: page,
    },
    links,
    publications: books.map((b) => opds2Publication(origin, b)),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono<OpdsEnv>();

app.use("*", opdsAuthMiddleware);

// GET / — Root navigation feed
app.get("/", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const origin = requestOrigin(c);
  const now = isoDate(Date.now());

  const shelves = await db
    .selectFrom("personal_shelf")
    .select(["id", "name"])
    .where("userDid", "=", userDid)
    .orderBy("name", "asc")
    .execute();

  if (negotiateFeedFormat(c)) {
    // Counts are only rendered in the 2.0 feed — OPDS 1.x has no navigation-link equivalent.
    const { total } = await db
      .selectFrom("personal_book")
      .select((eb) => eb.fn.countAll<number>().as("total"))
      .where("userDid", "=", userDid)
      .executeTakeFirstOrThrow();

    const shelfCounts = new Map<number, number>();
    if (shelves.length) {
      const rows = await db
        .selectFrom("personal_shelf_item")
        .select((eb) => ["shelfId", eb.fn.countAll<number>().as("count")])
        .where(
          "shelfId",
          "in",
          shelves.map((s) => s.id),
        )
        .groupBy("shelfId")
        .execute();
      for (const row of rows) shelfCounts.set(row.shelfId, row.count);
    }

    return c.json(
      {
        metadata: { title: "BookHive Library" },
        links: [{ rel: "self", href: `${origin}/opds`, type: OPDS2_TYPE }, opds2SearchLink(origin)],
        navigation: [
          {
            title: "All Books",
            href: `${origin}/opds/all`,
            type: OPDS2_TYPE,
            properties: { numberOfItems: total },
          },
          ...shelves.map((shelf) => ({
            title: shelf.name,
            href: `${origin}/opds/shelves/${shelf.id}`,
            type: OPDS2_TYPE,
            properties: { numberOfItems: shelfCounts.get(shelf.id) ?? 0 },
          })),
        ],
      },
      200,
      { "Content-Type": OPDS2_TYPE },
    );
  }

  const navEntry = (id: string, title: string, href: string) =>
    `<entry><title>${escapeXml(title)}</title><id>${id}</id>` +
    `<updated>${now}</updated>` +
    `<link rel="subsection" href="${href}" type="${OPDS_ACQ_TYPE}"/>` +
    `</entry>`;

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

/**
 * Answer with an acquisition feed in whichever format the reader negotiated.
 * The three acquisition routes used to duplicate this by hand, and the copies
 * had drifted — the 1.2 feed emits `rel="up"` and the 2.0 feed does not.
 */
function respondAcquisitionFeed(
  c: Context<AppEnv & { Variables: { opdsUserDid: string } }>,
  opts: {
    feedId: string;
    title: string;
    selfPath: string;
    books: BookForEntry[];
    page: number;
    totalPages: number;
    total: number;
  },
) {
  const origin = requestOrigin(c);
  if (negotiateFeedFormat(c)) {
    return c.json(opds2AcquisitionFeed(origin, opts), 200, { "Content-Type": OPDS2_TYPE });
  }
  return c.body(opdsAcquisitionFeed(origin, opts), 200, { "Content-Type": OPDS_ACQ_TYPE });
}

// GET /all — Acquisition feed: all books
app.get("/all", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const page = parsePage(c);

  const { rows: books, total } = await listPersonalBooks({
    db,
    userDid,
    limit: OPDS_PAGE_SIZE,
    offset: pageOffset(page, OPDS_PAGE_SIZE),
  });
  const { totalPages } = calculatePagination(total, OPDS_PAGE_SIZE, page);

  return respondAcquisitionFeed(c, {
    feedId: "urn:bookhive:all",
    title: "All Books",
    selfPath: "/opds/all",
    books,
    page,
    totalPages,
    total,
  });
});

// GET /shelves/:id — Acquisition feed: books on a shelf
app.get("/shelves/:id", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
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

  // The count and the data query must share the same `userDid` filter or they can disagree.
  const { rows: books, total } = await listPersonalBooks({
    db,
    userDid,
    shelfId,
    limit: OPDS_PAGE_SIZE,
    offset: pageOffset(page, OPDS_PAGE_SIZE),
  });
  const { totalPages } = calculatePagination(total, OPDS_PAGE_SIZE, page);

  return respondAcquisitionFeed(c, {
    feedId: `urn:bookhive:shelf:${shelfId}`,
    title: shelf.name,
    selfPath: `/opds/shelves/${shelfId}`,
    books,
    page,
    totalPages,
    total,
  });
});

// GET /books/:hash/download/{name}.ext — Stream book file.
// The trailing name is ignored — the hash identifies the file — but required,
// not optional, since readers follow the feed's href fresh on every sync.
app.get("/books/:hash/download/:filename", async (c) => {
  const userDid = c.get("opdsUserDid");
  const { db } = c.get("ctx");
  const hash = c.req.param("hash");

  const download = await streamPersonalBook(db, userDid, hash, c.req.header("if-none-match"), {
    range: c.req.header("range"),
    ifRange: c.req.header("if-range"),
  });
  if (!download) {
    return c.body("Not found", 404);
  }
  // A bare Response, not `c.body()`: hono types the latter's status against
  // ContentfulStatusCode, which excludes the 304 this can return.
  return new Response(download.stream, {
    status: download.status,
    headers: download.headers,
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

  if (book.coverPath) {
    const file = Bun.file(book.coverPath);
    if (await file.exists()) {
      // This route is under `/opds/books/`, excluded from hono's etag()
      // middleware, so without our own validator a 304 is impossible.
      const etag = `"${hash}-cover"`;
      const headers = {
        "Content-Type": book.coverMime || "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        ETag: etag,
      };
      if (etagMatches(c.req.header("if-none-match"), etag)) {
        return c.body(null, 304, headers);
      }
      return c.body(file.stream(), 200, headers);
    }
  }

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
  const opds2 = negotiateFeedFormat(c);
  // OpenSearch (1.x) advertises `q`; the OPDS 2.0 URI template expands to `query`.
  const q = (c.req.query("q") ?? c.req.query("query"))?.trim();

  if (!q) {
    if (opds2) {
      return c.json(
        opds2AcquisitionFeed(origin, {
          title: "Search Results",
          selfPath: "/opds/search/results",
          books: [],
          page: 1,
          totalPages: 1,
          total: 0,
        }),
        200,
        { "Content-Type": OPDS2_TYPE },
      );
    }
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

  const { rows: books, total } = await listPersonalBooks({
    db,
    userDid,
    q,
    sort: "title",
    limit: OPDS_PAGE_SIZE,
    offset: pageOffset(page, OPDS_PAGE_SIZE),
  });
  const { totalPages } = calculatePagination(total, OPDS_PAGE_SIZE, page);

  return respondAcquisitionFeed(c, {
    feedId: `urn:bookhive:search:${encodeURIComponent(q)}`,
    title: `Search: ${q}`,
    // Echo whichever param the reader actually used in the self link.
    selfPath: `/opds/search/results?${opds2 ? "query" : "q"}=${encodeURIComponent(q)}`,
    books,
    page,
    totalPages,
    total,
  });
});

export default app;
