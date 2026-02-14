import type { AppBskyActorDefs } from "@atcute/bluesky";

export type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;

export type * as GetBook from "./bsky/lexicon/generated/types/buzz/bookhive/getBook";
export type * as GetBookIdentifiers from "./bsky/lexicon/generated/types/buzz/bookhive/getBookIdentifiers";
export type * as GetProfile from "./bsky/lexicon/generated/types/buzz/bookhive/getProfile";

/**
 * Hive ID is a hash of the book's title & author
 * Used to uniquely identify a book within the hive
 */
export type HiveId = `bk_${string}`;

export type BookProgress = {
  percent?: number;
  totalPages?: number;
  currentPage?: number;
  totalChapters?: number;
  currentChapter?: number;
  updatedAt: string;
};

export type BookIdentifiers = {
  hiveId?: string;
  isbn10?: string;
  isbn13?: string;
  goodreadsId?: string;
  amazonAsin?: string;
  googleBooksId?: string;
  openLibraryId?: string;
};

export type UserBook = {
  /**
   * Most recent time the book was indexed
   */
  indexedAt: string;
  /**
   * URI of the book
   */
  uri: string;
  /**
   * CID of the book
   */
  cid: string;
  /**
   * Hive ID of the book
   */
  hiveId: HiveId;
  /**
   * DID of the user who added the book
   */
  userDid: string;
  /**
   * Time the book was added
   */
  createdAt: string;
  /**
   * Status of the book
   */
  status: string | null;
  /**
   * Started reading at
   */
  startedAt: string | null;
  /**
   * Finished reading at
   */
  finishedAt: string | null;
  /**
   * Book title
   */
  title: string;
  /**
   * Authors are stored as a tab-separated string
   */
  authors: string;
  /**
   * Rating out of 10
   */
  stars: number | null;
  /**
   * Review of the book
   */
  review: string | null;
  /**
   * Reading progress information
   */
  bookProgress: BookProgress | null;
};

export type UserBookRow = Omit<UserBook, "bookProgress"> & {
  bookProgress: string | null;
};

export type Buzz = {
  /**
   * Time the buzz was indexed
   */
  indexedAt: string;
  /**
   * URI of the buzz
   */
  uri: string;
  /**
   * CID of the buzz
   */
  cid: string;
  /**
   * DID of the user who added the buzz
   */
  userDid: string;
  /**
   * Time the buzz was added
   */
  createdAt: string;
  /**
   * Actual comment content
   */
  comment: string;
  /**
   * The book being buzzed about
   */
  bookUri: string;
  /**
   * CID of the book being buzzed about
   */
  bookCid: string;
  /**
   * The book's hive ID
   */
  hiveId: HiveId;
  /**
   * URI of the parent buzz or review
   */
  parentUri: string;
  /**
   * CID of the parent buzz or review
   */
  parentCid: string;
};

export type HiveBook = {
  id: HiveId;
  title: string;
  /**
   * Authors are stored as a tab-separated string
   */
  authors: string;
  source: string;
  sourceUrl: string | null;
  sourceId: string | null;
  cover: string | null;
  thumbnail: string;
  description: string | null;
  rating: number | null;
  ratingsCount: number | null;
  createdAt: string;
  updatedAt: string;
  rawTitle: string | null;
  genres: string | null;
  series: string | null;
  meta: string | null;
  enrichedAt: string | null;
  /**
   * External identifiers stored as JSON string
   */
  identifiers: string | null;
};

/** Row shape for the book_id_map table (indexed book identifiers). */
export type BookIdentifiersRow = {
  hiveId: HiveId;
  isbn: string | null;
  isbn13: string | null;
  goodreadsId: string | null;
  updatedAt: string;
};

export type UserFollow = {
  /**
   * DID of the user who is following
   */
  userDid: string;
  /**
   * DID of the user being followed
   */
  followsDid: string;
  /**
   * When the follow relationship was created on Bluesky
   */
  followedAt: string;
  /**
   * When we synced this relationship
   */
  syncedAt: string;
  /**
   * Last time we saw this follow in a sync
   */
  lastSeenAt: string;
  /**
   * Whether this follow is currently active (1 = true, 0 = false)
   */
  isActive: number;
};

type Simplify<T> = {
  [K in keyof T]: T[K];
};

type HiveFields = Pick<
  HiveBook,
  "cover" | "thumbnail" | "description" | "rating"
>;

/**
 * This is the result of a user's actual PDS data which may or may not include Hive data
 */
export type Book = Simplify<
  UserBook & {
    [K in keyof HiveFields]: HiveFields[K] | null;
  }
>;
