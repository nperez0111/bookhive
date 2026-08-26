import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { rm } from "node:fs/promises";
import path from "node:path";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { parseByteRange, streamPersonalBook } from "./personalLibrary";
import { attachmentDisposition } from "./contentDisposition";
import { canonicalDownloadFilename } from "./downloadFilename";

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
    expect(result!.status).toBe(200);
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
    expect(result!.headers["Content-Type"]).toBe("application/epub+zip");
  });

  // The regression: these routes are excluded from hono's etag() middleware
  // because it buffers the whole body through a digest. That middleware was
  // also what turned If-None-Match into a 304 — setting the header alone does
  // not, so without this branch an e-reader re-downloads every book on every
  // sync.
  it("returns a 304 when If-None-Match matches the content hash", async () => {
    const result = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(304);
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
    expect(result!.stream).toBeNull();
  });

  it("handles the weak prefix, comma lists and wildcard clients send", async () => {
    for (const header of [`W/"${HASH}"`, `"other", "${HASH}"`, "*"]) {
      const result = await streamPersonalBook(db, DID, HASH, header);
      expect(result!.status).toBe(304);
    }
  });

  it("still streams when the validator is for a different version", async () => {
    const result = await streamPersonalBook(db, DID, HASH, `"stale-hash"`);
    expect(result!.status).toBe(200);
  });

  it("answers the conditional request without touching the file", async () => {
    // A 304 must not depend on the file still being readable — otherwise a
    // missing file turns a cheap revalidation into a 404 for a book the client
    // already has.
    await rm(filePath, { force: true });
    const result = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(result!.status).toBe(304);
  });

  it("returns null for another user's book", async () => {
    expect(await streamPersonalBook(db, "did:plc:someoneelse", HASH)).toBeNull();
  });
});

describe("range requests", () => {
  // "epub bytes" — 10 bytes, matching sizeBytes above.
  const SIZE = 10;

  const read = async (stream: ReadableStream | null) =>
    stream ? await new Response(stream).text() : null;

  it("advertises Accept-Ranges on a plain download", async () => {
    const result = await streamPersonalBook(db, DID, HASH);
    expect(result!.headers["Accept-Ranges"]).toBe("bytes");
    expect(result!.headers["Content-Length"]).toBe(String(SIZE));
  });

  it("advertises Accept-Ranges on the 304 too", async () => {
    // The client that needs to resume is precisely the one that has seen a
    // validator before, so the header has to survive revalidation.
    const result = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(result!.status).toBe(304);
    expect(result!.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("serves a 206 with the right slice, Content-Range and Content-Length", async () => {
    const result = await streamPersonalBook(db, DID, HASH, null, { range: "bytes=5-8" });
    expect(result!.status).toBe(206);
    expect(result!.headers["Content-Range"]).toBe(`bytes 5-8/${SIZE}`);
    expect(result!.headers["Content-Length"]).toBe("4");
    expect(await read(result!.stream)).toBe("byte");
  });

  it("resumes an open-ended range to the end of the file", async () => {
    const result = await streamPersonalBook(db, DID, HASH, null, { range: "bytes=5-" });
    expect(result!.status).toBe(206);
    expect(result!.headers["Content-Range"]).toBe(`bytes 5-9/${SIZE}`);
    expect(await read(result!.stream)).toBe("bytes");
  });

  it("serves a suffix range", async () => {
    const result = await streamPersonalBook(db, DID, HASH, null, { range: "bytes=-5" });
    expect(result!.status).toBe(206);
    expect(result!.headers["Content-Range"]).toBe(`bytes 5-9/${SIZE}`);
    expect(await read(result!.stream)).toBe("bytes");
  });

  it("answers a past-the-end range with 416 and the real length", async () => {
    const result = await streamPersonalBook(db, DID, HASH, null, { range: "bytes=99-" });
    expect(result!.status).toBe(416);
    expect(result!.stream).toBeNull();
    expect(result!.headers["Content-Range"]).toBe(`bytes */${SIZE}`);
  });

  it("ignores a Range whose If-Range no longer matches the file", async () => {
    // The file changed under the client, so the half it already holds is from a
    // different book; only the whole new representation is a correct answer.
    const result = await streamPersonalBook(db, DID, HASH, null, {
      range: "bytes=5-",
      ifRange: '"some-older-hash"',
    });
    expect(result!.status).toBe(200);
    expect(result!.headers["Content-Length"]).toBe(String(SIZE));
    expect(await read(result!.stream)).toBe("epub bytes");
  });

  it("honours a Range whose If-Range still matches", async () => {
    const result = await streamPersonalBook(db, DID, HASH, null, {
      range: "bytes=5-",
      ifRange: `"${HASH}"`,
    });
    expect(result!.status).toBe(206);
  });
});

describe("parseByteRange", () => {
  it("ignores anything it does not serve rather than failing the request", () => {
    // RFC 9110 lets a server ignore a Range it doesn't want to handle. A 200
    // with the whole file is always a correct answer; a 416 is not.
    expect(parseByteRange(undefined, 10)).toBeNull();
    expect(parseByteRange("items=0-5", 10)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 10)).toBeNull(); // multipart/byteranges
    expect(parseByteRange("bytes=abc", 10)).toBeNull();
  });

  it("clamps an over-long end to the last byte", () => {
    expect(parseByteRange("bytes=2-999", 10)).toEqual({ start: 2, end: 9 });
  });

  it("treats an inverted or out-of-bounds range as unsatisfiable", () => {
    expect(parseByteRange("bytes=8-3", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("caps a suffix longer than the file at the whole file", () => {
    expect(parseByteRange("bytes=-99", 10)).toEqual({ start: 0, end: 9 });
  });
});

describe("Content-Disposition", () => {
  it("carries both parameter forms", async () => {
    const result = await streamPersonalBook(db, DID, HASH);
    expect(result!.headers["Content-Disposition"]).toBe(
      `attachment; filename="book.epub"; filename*=UTF-8''book.epub`,
    );
  });

  // The regression: encodeURIComponent leaves `'` alone, and `'` is the
  // delimiter inside an RFC 8187 ext-value, so the old header truncated every
  // title with an apostrophe in it at the apostrophe.
  it("percent-encodes the characters encodeURIComponent leaves alone", () => {
    const name = "The Handmaid's Tale (Special)!~*.epub";
    const header = attachmentDisposition(name, canonicalDownloadFilename(name, "epub"));
    expect(header).not.toContain("''The Handmaid'");
    const extValue = header.split("filename*=UTF-8''")[1]!;
    // `!` and `~` are attr-char, so they are correctly left as-is; `'`, `(`,
    // `)` and `*` are not, and are exactly what the old encoding let through.
    expect(extValue).toBe("The%20Handmaid%27s%20Tale%20%28Special%29!~%2A.epub");
    expect(decodeURIComponent(extValue)).toBe("The Handmaid's Tale (Special)!~*.epub");
  });

  it("keeps a plain ASCII filename for clients that ignore filename*", () => {
    // Without this a reader that can't parse filename* falls back to the URL's
    // last segment, which used to be the extension-less "download".
    const name = "Война и мир.epub";
    const header = attachmentDisposition(name, canonicalDownloadFilename(name, "epub"));
    expect(header).toContain(`filename="`);
    const plain = /filename="([^"]*)"/.exec(header)![1]!;
    expect(plain).toMatch(/\.epub$/);
    expect(plain).toMatch(/^[\x20-\x7E]*$/);
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1]!)).toBe("Война и мир.epub");
  });

  it("escapes the quoted-string metacharacters", () => {
    const name = 'a"b\\c.epub';
    const header = attachmentDisposition(name, canonicalDownloadFilename(name, "epub"));
    expect(/filename="([^"]*)"/.exec(header)![1]).toBe("a_b_c.epub");
  });

  // The plain parameter is a quoted-string. A caller passing something other
  // than `canonicalDownloadFilename` (which cannot produce either character)
  // must not be able to close the quote and append parameters of its own.
  it("escapes a quote or backslash reaching the plain filename", () => {
    const header = attachmentDisposition("x.epub", 'a".epub"; x=y\\z');
    expect(/filename="((?:[^"\\]|\\.)*)"/.exec(header)![1]).toBe('a\\".epub\\"; x=y\\\\z');
    expect(header).not.toContain("\r");
  });

  it("never emits an empty plain filename", () => {
    expect(
      /filename="([^"]*)"/.exec(
        attachmentDisposition("книга", canonicalDownloadFilename("книга", "epub")),
      )![1],
    ).not.toBe("");
  });
});

describe("serving a derived EPUB", () => {
  const epubPath = "/tmp/personal-library-test-derived.epub";

  const linkEpub = async () => {
    await Bun.write(epubPath, "converted epub bytes");
    await db
      .updateTable("personal_book")
      .set({ epubPath, epubSizeBytes: 20 })
      .where("userDid", "=", DID)
      .where("contentHash", "=", HASH)
      .execute();
  };

  it("serves the converted bytes, not the original", async () => {
    await linkEpub();
    const result = await streamPersonalBook(db, DID, HASH);
    expect(result!.status).toBe(200);
    expect(await new Response(result!.stream).text()).toBe("converted epub bytes");
    expect(result!.headers["Content-Type"]).toBe("application/epub+zip");
  });

  // The trap: contentHash is the hash of the *original*. Reusing it bare would
  // tell a client holding the MOBI that it already has the EPUB, and it would
  // keep the stale copy forever.
  it("uses a distinct validator from the original representation", async () => {
    const before = await streamPersonalBook(db, DID, HASH);
    expect(before!.headers["ETag"]).toBe(`"${HASH}"`);

    await linkEpub();
    const after = await streamPersonalBook(db, DID, HASH);
    expect(after!.headers["ETag"]).toBe(`"${HASH}-epub"`);

    // A client revalidating with the original's validator must be sent the
    // new bytes, not a 304.
    const revalidated = await streamPersonalBook(db, DID, HASH, `"${HASH}"`);
    expect(revalidated!.status).toBe(200);
    // ...and the EPUB's own validator still earns its 304.
    const fresh = await streamPersonalBook(db, DID, HASH, `"${HASH}-epub"`);
    expect(fresh!.status).toBe(304);
  });

  // `epubPath` points at a second file the quota does not account for and that
  // nothing re-derives. If it goes missing, failing the download would lose the
  // user the original too — which is right there on disk.
  it("falls back to the original when the derived EPUB has gone missing", async () => {
    await db
      .updateTable("personal_book")
      .set({ format: "mobi", mime: "application/x-mobipocket-ebook" })
      .where("contentHash", "=", HASH)
      .execute();
    await linkEpub();
    await rm(epubPath, { force: true });

    const result = await streamPersonalBook(db, DID, HASH);
    expect(result!.status).toBe(200);
    expect(await new Response(result!.stream).text()).toBe("epub bytes");
    // ...as the original representation throughout, not an EPUB label over
    // MOBI bytes: a client that cached under the `-epub` validator must not be
    // told these are the same thing.
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
    expect(result!.headers["Content-Type"]).toBe("application/x-mobipocket-ebook");
  });

  it("names the download with the served extension", async () => {
    await linkEpub();
    const result = await streamPersonalBook(db, DID, HASH);
    expect(result!.headers["Content-Disposition"]).toContain('filename="book.epub"');
  });

  // The regression: `filename*` was derived from the canonical ASCII name, so
  // both parameters carried the lossy form. A title with no ASCII form lost
  // itself entirely on conversion, while the same file served un-converted
  // kept its name.
  it("keeps the user's real filename in filename* when serving a conversion", async () => {
    await db
      .updateTable("personal_book")
      .set({ filename: "Война и мир.mobi", format: "mobi" })
      .where("contentHash", "=", HASH)
      .execute();
    await linkEpub();

    const header = (await streamPersonalBook(db, DID, HASH))!.headers["Content-Disposition"]!;
    const extValue = header.split("filename*=UTF-8''")[1]!;
    // Only the extension moves to the served format; the stem survives intact.
    expect(decodeURIComponent(extValue)).toBe("Война и мир.epub");
    // The ASCII fallback is still the lossy form — that is what it is for.
    expect(header).toContain('filename="book.epub"');
  });

  it("swaps only the extension for a Latin filename", async () => {
    await db
      .updateTable("personal_book")
      .set({ filename: "Dune Messiah.azw3", format: "mobi" })
      .where("contentHash", "=", HASH)
      .execute();
    await linkEpub();

    const header = (await streamPersonalBook(db, DID, HASH))!.headers["Content-Disposition"]!;
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1]!)).toBe("Dune Messiah.epub");
    expect(header).toContain('filename="Dune_Messiah.epub"');
  });

  it("ranges over the converted file's length, not the original's", async () => {
    await linkEpub();
    const result = await streamPersonalBook(db, DID, HASH, null, { range: "bytes=0-8" });
    expect(result!.status).toBe(206);
    expect(result!.headers["Content-Range"]).toBe("bytes 0-8/20");
    expect(await new Response(result!.stream).text()).toBe("converted");
  });

  it("falls back to the original when no EPUB was derived", async () => {
    const result = await streamPersonalBook(db, DID, HASH);
    expect(await new Response(result!.stream).text()).toBe("epub bytes");
    expect(result!.headers["ETag"]).toBe(`"${HASH}"`);
  });
});
