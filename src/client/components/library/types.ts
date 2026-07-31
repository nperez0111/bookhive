/** E-reader reading progress for a book, as returned by getPersonalLibrary. */
export type SyncProgress = {
  /** Fraction between 0 and 1, transported as a string by the lexicon. */
  percentage: string;
  device?: string;
  updatedAt: string;
};

/** A file in the user's personal library — i.e. one entry in their OPDS catalog. */
export type PersonalBook = {
  contentHash: string;
  title: string;
  authors: string | null;
  language: string | null;
  format: string;
  mime: string;
  sizeBytes: number;
  coverUrl: string | null;
  hiveId: string | null;
  createdAt: string;
  updatedAt: string;
  progress?: SyncProgress;
  shelfIds?: number[];
};

/** A server-local shelf, exposed to e-readers as its own OPDS acquisition feed. */
export type Shelf = {
  id: number;
  name: string;
  description?: string;
  bookCount: number;
  createdAt: string;
  updatedAt: string;
};

/** A document the e-reader has reported progress for. */
export type SyncDoc = {
  document: string;
  title: string | null;
  authors: string | null;
  filename: string | null;
  /** Fraction between 0 and 1. */
  percentage: number;
  device: string | null;
  updatedAt: string;
  hiveId: string | null;
  bookTitle: string | null;
  /** The user asserted this document has no BookHive counterpart. */
  dismissed: boolean;
  /** A file with the same content hash exists in the library, so the grid owns it. */
  hasFile: boolean;
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Tab-separated authors, as stored, rendered as a comma list. */
export const authorsDisplay = (authors: string | null): string =>
  authors?.replace(/\t/g, ", ") ?? "";

/** Fraction (0..1) → whole percent, clamped. */
export const toPercent = (fraction: number): number =>
  Math.max(0, Math.min(100, Math.round(fraction * 100)));

export const bookPercent = (book: PersonalBook): number | null =>
  book.progress ? toPercent(Number(book.progress.percentage) || 0) : null;

export const syncDocName = (doc: SyncDoc): string =>
  doc.title || doc.filename || "Untitled document";

export const formatSynced = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** Secondary line for a sync document row: whichever identifying bits we have. */
export const syncDocMeta = (doc: SyncDoc): string =>
  [
    authorsDisplay(doc.authors),
    `${toPercent(doc.percentage)}% read`,
    doc.device,
    formatSynced(doc.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
