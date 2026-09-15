import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { env } from "../env";
import { attachmentDisposition } from "../lib/contentDisposition";
import { canonicalDownloadFilename, withExtension } from "../core/downloadFilename";
import type { Database } from "../db";

/** Number of items per page in OPDS catalog responses. */
export const OPDS_PAGE_SIZE = 24;

/**
 * Largest accepted ebook upload. The format parsers need the whole file in
 * one contiguous buffer (fflate reads a ZIP's central directory from the
 * end), so this is the per-request ceiling on native memory for the parse
 * step even though the body itself streams to disk.
 */
export const MAX_PERSONAL_BOOK_BYTES = 100 * 1024 * 1024;

/**
 * Root directory for all personal library files. `LIBRARY_DIR` wins when set,
 * so the library can live on a different volume from the DB; otherwise it sits
 * adjacent to the DB as it always has.
 */
export function getLibraryDir(): string {
  return env.LIBRARY_DIR || path.join(path.dirname(env.DB_PATH), "library");
}

/**
 * Scratch directory for in-flight uploads. Deliberately under the library root
 * so the finished file can be `rename`d into place rather than copied — that
 * only holds within one filesystem.
 */
export function getLibraryTmpDir(): string {
  return path.join(getLibraryDir(), ".tmp");
}

/** Directory for a specific book: `{libraryDir}/{did}/{contentHash}/` */
export function personalBookDir(did: string, contentHash: string): string {
  return path.join(getLibraryDir(), did, contentHash);
}

/** Path to the book file: `{bookDir}/book.{ext}` */
export function bookFilePath(did: string, contentHash: string, ext: string): string {
  return path.join(personalBookDir(did, contentHash), "book." + ext);
}

/**
 * Path to the derived EPUB: `{bookDir}/book.epub`.
 *
 * Sits beside the original rather than replacing it — conversion is lossy, so a
 * derived file must stay re-derivable. `removeBookDir` already takes both.
 */
export function epubFilePath(did: string, contentHash: string): string {
  return path.join(personalBookDir(did, contentHash), "book.epub");
}

/** Path to the cover image: `{bookDir}/cover.{ext}` */
export function coverFilePath(did: string, contentHash: string, ext: string): string {
  return path.join(personalBookDir(did, contentHash), "cover." + ext);
}

/** Create a directory recursively if it doesn't exist. */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/** Remove a book's directory from disk. */
export async function removeBookDir(did: string, contentHash: string): Promise<void> {
  await rm(personalBookDir(did, contentHash), { recursive: true, force: true });
}

/** Remove a user's entire library directory (for account deletion). */
export async function removeUserDir(did: string): Promise<void> {
  await rm(path.join(getLibraryDir(), did), { recursive: true, force: true });
}

/** Total bytes one user may store across their personal library. */
export function getStorageQuota(): number {
  return env.PERSONAL_LIBRARY_QUOTA_BYTES;
}

/**
 * Bytes this user currently stores. Derived with a `SUM`, never a maintained
 * counter — `idx_personal_book_user_size` keeps it an index-only scan, and a
 * counter could drift silently since `removeBookDir` is best-effort.
 */
export async function getStorageUsage(db: Database, userDid: string): Promise<number> {
  const row = await db
    .selectFrom("personal_book")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>("sizeBytes"), eb.lit(0)).as("used"))
    .where("userDid", "=", userDid)
    .executeTakeFirst();
  return Number(row?.used ?? 0);
}

/**
 * A ready-to-send download response. `status` covers all four outcomes rather
 * than a `notModified` flag, because range requests added two more (206 and
 * 416) and callers all do the same `new Response(stream, { status, headers })`.
 * `stream` is null exactly when the status carries no body.
 */
export type PersonalBookDownload =
  | { status: 200 | 206; stream: ReadableStream; headers: Record<string, string> }
  | { status: 304 | 416; stream: null; headers: Record<string, string> };

/** A byte range resolved against a known file size, inclusive on both ends. */
type ResolvedRange = { start: number; end: number };

/**
 * Parse a single-range `Range` header against the file size.
 *
 * Returns the resolved range, `"unsatisfiable"` (→ 416), or null meaning
 * "ignore the header and send the whole thing" (RFC 9110 §14.2 permits this).
 * Multi-range requests deliberately take the null path — nothing that reads
 * ebooks asks for a `multipart/byteranges` body.
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number,
): ResolvedRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (!match) return null;

  const spec = match[1]!.trim();
  if (spec.includes(",")) return null;

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return null;
  const [, rawStart, rawEnd] = parts;

  // A zero-length file can satisfy no range at all, only the whole (empty)
  // representation, so every range against it is unsatisfiable.
  if (size === 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (rawStart === "") {
    // `bytes=-N` — the *last* N bytes. `bytes=-0` is meaningless and invalid.
    const suffix = Number(rawEnd);
    if (rawEnd === "" || !Number.isFinite(suffix) || suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isFinite(start)) return null;
    if (start >= size) return "unsatisfiable";
    // An absent or past-the-end `last-pos` clamps to the final byte rather than
    // failing — that is what makes the common `bytes=N-` resume work.
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
    if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  }

  return { start, end };
}

/**
 * Does an `If-None-Match` header match our strong ETag? Handles the comma list
 * and `*` forms, and tolerates the `W/` prefix a client may echo back — the
 * validator is a content hash, so a weak match is still the same bytes.
 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalize = (raw: string) => raw.trim().replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .some((candidate) => normalize(candidate) === "*" || normalize(candidate) === etag);
}

/**
 * Which representation a download actually serves.
 *
 * Shared by `streamPersonalBook` and the OPDS feed builder so the bytes and the
 * advertised `type=` can never disagree — a feed claiming `application/mobi`
 * for a link that returns an EPUB is exactly the kind of mismatch an e-reader
 * silently refuses to act on.
 */
export function servedRepresentation(book: {
  format: string;
  mime: string | null;
  epubPath: string | null;
}): { format: string; mime: string; isEpub: boolean } {
  if (book.epubPath) return { format: "epub", mime: "application/epub+zip", isEpub: true };
  return {
    format: book.format,
    mime: book.mime || "application/epub+zip",
    isEpub: book.format === "epub",
  };
}

/**
 * Stream a personal library book file as an attachment. Shared by the OPDS
 * acquisition endpoint (HTTP Basic auth), the web download button (session
 * auth) and the XRPC blob method so the three can't drift. Returns null when
 * the row or file is missing; callers turn that into their own 404.
 *
 * Handles conditional and range requests itself and hands back a status —
 * see the comments on each branch for why neither can be left to middleware.
 */
export async function streamPersonalBook(
  db: Database,
  userDid: string,
  contentHash: string,
  ifNoneMatch?: string | null,
  rangeHeaders?: { range?: string | null; ifRange?: string | null },
): Promise<PersonalBookDownload | null> {
  const book = await db
    .selectFrom("personal_book")
    .select(["filePath", "filename", "mime", "format", "epubPath"])
    .where("userDid", "=", userDid)
    .where("contentHash", "=", contentHash)
    .executeTakeFirst();
  if (!book) return null;

  // Serve the derived EPUB whenever there is one — some e-readers (e.g.
  // CrossPoint) require `type == "application/epub+zip"` exactly — but fall
  // back to the original if the derived file has gone missing on disk rather
  // than fail the whole download. Must resolve before the ETag and filename,
  // which both key off the representation.
  const serveEpub = book.epubPath ? await Bun.file(book.epubPath).exists() : false;
  const served = servedRepresentation(serveEpub ? book : { ...book, epubPath: null });
  const servePath = serveEpub && book.epubPath ? book.epubPath : book.filePath;
  const { format: serveFormat, mime: serveMime } = served;

  // Suffixed so a client holding the original doesn't get told (via a bare
  // contentHash) that it already has the derived EPUB.
  const etag = serveEpub ? `"${contentHash}-epub"` : `"${contentHash}"`;
  const cacheHeaders = {
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
    // Advertised on every response, including the 304 and the 416: a client
    // decides whether resuming is even worth attempting from this header, and
    // it will have seen it on the 200 that got interrupted.
    "Accept-Ranges": "bytes",
  };

  // Answer the conditional request *before* opening the file — these routes
  // are excluded from hono's `etag()` middleware (it buffers the whole body),
  // and setting the header alone does nothing without this branch.
  if (etagMatches(ifNoneMatch, etag)) {
    return { status: 304, stream: null, headers: cacheHeaders };
  }

  const file = Bun.file(servePath);
  if (!(await file.exists())) return null;
  const size = file.size;

  // `filename*` carries the user's real filename; the plain fallback is the
  // canonical ASCII name the download URL ends in. For a converted book only
  // the extension moves to the served format — `filename*` must keep the real
  // stem, not the lossy ASCII form.
  const canonicalName = canonicalDownloadFilename(book.filename, serveFormat);
  const downloadName = serveEpub
    ? withExtension(book.filename, serveFormat)
    : book.filename.toLowerCase().includes(".")
      ? book.filename
      : `${book.filename}.${book.format || "epub"}`;

  const baseHeaders = {
    "Content-Type": serveMime,
    "Content-Disposition": attachmentDisposition(downloadName, canonicalName),
    ...cacheHeaders,
  };

  // `If-Range` makes a resume safe: the client is saying "send me the rest only
  // if the file is still the one I hold". Our validator is a content hash, so a
  // mismatch means a genuinely different file and the only correct answer is
  // the whole of the new one.
  const ifRange = rangeHeaders?.ifRange;
  const rangeStillValid = !ifRange || etagMatches(ifRange, etag);

  const range = rangeStillValid ? parseByteRange(rangeHeaders?.range, size) : null;

  if (range === "unsatisfiable") {
    return {
      status: 416,
      stream: null,
      // RFC 9110 §15.5.17: a 416 must say how long the representation actually
      // is, so the client can re-ask for something that exists.
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    };
  }

  if (range) {
    return {
      status: 206,
      // `Bun.file().slice()` is lazy — it seeks, it does not read the skipped
      // prefix — so resuming a 100 MB book near its end costs nothing.
      stream: file.slice(range.start, range.end + 1).stream(),
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    };
  }

  return {
    status: 200,
    stream: file.stream(),
    headers: { ...baseHeaders, "Content-Length": String(size) },
  };
}
