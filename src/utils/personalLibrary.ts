import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { env } from "../env";
import type { Database } from "../db";

/** Number of items per page in OPDS catalog responses. */
export const OPDS_PAGE_SIZE = 24;

/**
 * Largest accepted ebook upload. The body itself streams to disk, but the
 * format parsers need the whole file in one contiguous buffer (fflate reads a
 * ZIP's central directory from the end), so this remains the per-request
 * ceiling on native memory for the parse step. Enforce it against the
 * *declared* size first, then again while streaming.
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
 * counter: the quota itself bounds the row count (2 GB over a ~3 MB median
 * epub is ~700 rows), `idx_personal_book_user_size` makes it an index-only
 * scan, and a derived total cannot drift. A counter would need a backfill,
 * decrements in both delete paths, and a repair job — and `removeBookDir` is
 * best-effort, so a failed `rm` after a row delete would leave the counter
 * under-reporting forever while the disk quietly filled.
 */
export async function getStorageUsage(db: Database, userDid: string): Promise<number> {
  const row = await db
    .selectFrom("personal_book")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>("sizeBytes"), eb.lit(0)).as("used"))
    .where("userDid", "=", userDid)
    .executeTakeFirst();
  return Number(row?.used ?? 0);
}

export type PersonalBookDownload =
  | { notModified: true; headers: Record<string, string> }
  | { notModified: false; stream: ReadableStream; headers: Record<string, string> };

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
