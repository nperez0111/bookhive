// Shared types for book metadata extraction across formats.

export interface BookCover {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

export interface BookMetadata {
  title: string;
  authors: string; // comma-separated
  language?: string;
  identifier?: string;
  cover?: BookCover;
}

// Back-compat aliases (the original module only supported EPUB).
export type EpubCover = BookCover;
export type EpubMetadata = BookMetadata;
