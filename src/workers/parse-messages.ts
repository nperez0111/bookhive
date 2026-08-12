/// Message contract between the upload path and the single-shot parse Worker
/// (`parse-worker.ts` / `parse-client.ts`). Only a file path crosses in; the
/// parsed metadata and the (already-rasterized, <=8 MB) cover cross back.

import type { BookCover, BookMetadata, FormatInfo } from "../utils/bookMetadata/index";

export type ParseRequest = {
  id: string;
  /** Absolute path to the on-disk upload; the Worker reads it with `Bun.file`. */
  path: string;
  filename: string;
  /** Already derived from the file head on the main thread — no need to re-sniff. */
  formatInfo: FormatInfo;
};

export type ParseResponse =
  | { id: string; ok: true; metadata: BookMetadata; cover: BookCover | undefined }
  | { id: string; ok: false; error: string };
