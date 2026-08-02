import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { env } from "../env";
import type { Database } from "../db";

/** Number of items per page in OPDS catalog responses. */
export const OPDS_PAGE_SIZE = 24;

/**
 * Largest accepted ebook upload. Every upload path materialises the whole file
 * as a `Uint8Array` (the KOReader partial MD5 and the format parsers both need
 * random access), so this is a direct per-request ceiling on native memory —
 * enforce it against the *declared* size before reading the body.
 */
export const MAX_PERSONAL_BOOK_BYTES = 100 * 1024 * 1024;

/** Root directory for all personal library files, adjacent to the DB. */
export function getLibraryDir(): string {
  return path.join(path.dirname(env.DB_PATH), "library");
}

/** Directory for a specific book: `{libraryDir}/{did}/{contentHash}/` */
export function personalBookDir(did: string, contentHash: string): string {
  return path.join(getLibraryDir(), did, contentHash);
}

/** Path to the book file: `{bookDir}/book.{ext}` */
export function bookFilePath(did: string, contentHash: string, ext: string): string {
  return path.join(personalBookDir(did, contentHash), "book." + ext);
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

export type PersonalBookDownload =
  | { notModified: true; headers: Record<string, string> }
  | { notModified: false; stream: ReadableStream; headers: Record<string, string> };

/**
 * Does an `If-None-Match` header match our strong ETag? Handles the comma list
 * and `*` forms, and tolerates the `W/` prefix a client may echo back — the
 * validator is a content hash, so a weak match is still the same bytes.
 */
function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalize = (raw: string) => raw.trim().replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .some((candidate) => normalize(candidate) === "*" || normalize(candidate) === etag);
}

/**
 * Stream a personal library book file as an attachment. Shared by the OPDS
 * acquisition endpoint (HTTP Basic auth) and the web download button (session
 * auth) so the two can't drift. Returns null when the row or file is missing;
 * callers turn that into their own 404.
 *
 * Pass the request's `If-None-Match` to get a `notModified` result instead of a
 * stream — see the comment on that branch for why this is done by hand.
 */
export async function streamPersonalBook(
  db: Database,
  userDid: string,
  contentHash: string,
  ifNoneMatch?: string | null,
): Promise<PersonalBookDownload | null> {
  const book = await db
    .selectFrom("personal_book")
    .select(["filePath", "filename", "mime", "format"])
    .where("userDid", "=", userDid)
    .where("contentHash", "=", contentHash)
    .executeTakeFirst();
  if (!book) return null;

  const etag = `"${contentHash}"`;
  const cacheHeaders = {
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  // Answer the conditional request *before* opening the file. These routes are
  // excluded from hono's `etag()` middleware (it buffers the whole body through
  // a digest — 134 MB of arrayBuffers for a 120 MB download), and that
  // middleware is what used to turn `If-None-Match` into a 304. Setting the
  // header alone does not: without this branch an e-reader re-downloads the
  // entire book on every sync.
  if (etagMatches(ifNoneMatch, etag)) {
    return { notModified: true, headers: cacheHeaders };
  }

  const file = Bun.file(book.filePath);
  if (!(await file.exists())) return null;

  const downloadName = book.filename.toLowerCase().includes(".")
    ? book.filename
    : `${book.filename}.${book.format || "epub"}`;

  return {
    notModified: false,
    stream: file.stream(),
    headers: {
      "Content-Type": book.mime || "application/epub+zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      ...cacheHeaders,
      "Content-Length": String(file.size),
    },
  };
}
