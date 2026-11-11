/** Uploaded files, not public catalogue tracking records. */
export type PersonalBook = {
  contentHash: string;
  title: string;
  authors?: string;
  language?: string;
  format: string;
  mime: string;
  sizeBytes: number;
  coverUrl?: string;
  /** Local covers need the viewer's cookie; public catalogue covers do not. */
  hasLocalCover?: boolean;
  hiveId?: string;
  filename?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** KOSync sends a decimal string, for example "0.42". */
  progress?: { percentage: string; device?: string; updatedAt: string };
  shelfIds?: number[];
};

export type PersonalStorage = { usedBytes: number; quotaBytes: number };

export type PersonalLibraryPage = {
  books: PersonalBook[];
  total?: number;
  cursor?: string;
  storage?: PersonalStorage;
};

/** Private numeric shelves are not public AT-URI catalogue shelves. */
export type PersonalShelf = {
  id: number;
  name: string;
  description?: string;
  bookCount: number;
  createdAt: string;
  updatedAt: string;
};

/** hasFile folds the document into a file card; dismissed suppresses match triage. */
export type SyncDoc = {
  document: string;
  title: string | null;
  authors: string | null;
  filename: string | null;
  percentage: number;
  device: string | null;
  updatedAt: string;
  hiveId: string | null;
  bookTitle: string | null;
  dismissed: boolean;
  hasFile: boolean;
};
