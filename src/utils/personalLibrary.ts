import path from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { env } from "../env";

/** Number of items per page in OPDS catalog responses. */
export const OPDS_PAGE_SIZE = 24;

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
