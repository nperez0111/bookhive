/** User has finished reading the book */
export const FINISHED = "buzz.bookhive.defs#finished";
/** User is currently reading the book */
export const READING = "buzz.bookhive.defs#reading";
/** User wants to read the book */
export const WANTTOREAD = "buzz.bookhive.defs#wantToRead";
/** User has abandoned the book */
export const ABANDONED = "buzz.bookhive.defs#abandoned";

export const BOOK_STATUS = {
  ABANDONED,
  READING,
  WANTTOREAD,
  FINISHED,
} as const;

/**
 * A status a book can be in. `null`/absent is its own thing — "the user tracks
 * this book but has asserted nothing about reading it" — so it is deliberately
 * *not* part of this union; say `BookStatus | null` where you mean that.
 * This is the only definition — don't reintroduce a second one elsewhere.
 */
export type BookStatus = (typeof BOOK_STATUS)[keyof typeof BOOK_STATUS];

export const BOOK_STATUS_MAP = {
  [ABANDONED]: "abandoned",
  [READING]: "reading",
  [WANTTOREAD]: "want to read",
  [FINISHED]: "read",
} as const;

/**
 * Status picker contents, ordered as the menus present them. The client island
 * kept its own copy of this list *and* its own copy of `BOOK_STATUS_MAP` under
 * the name `STATUS_LABELS`; both are now views of these tables.
 */
export const BOOK_STATUS_OPTIONS = [
  { value: FINISHED, label: "Read" },
  { value: READING, label: "Reading" },
  { value: WANTTOREAD, label: "Want to Read" },
  { value: ABANDONED, label: "Abandoned" },
] as const satisfies readonly { value: BookStatus; label: string }[];

export const BOOK_STATUS_PAST_TENSE_MAP = {
  [ABANDONED]: "marked this book as abandoned",
  [READING]: "is reading this book",
  [WANTTOREAD]: "wants to read this book",
  [FINISHED]: "has read this book",
} as const;

/**
 * Verbs for an activity-feed sentence: "@alice finished Dune".
 *
 * `BOOK_STATUS_PAST_TENSE_MAP` above is phrased for a card where the book is
 * implicit ("has read this book") and reads redundantly in a timeline row that
 * already names the title. Both are live; pick by surface.
 */
export const BOOK_STATUS_FEED_VERB_MAP = {
  [ABANDONED]: "gave up on",
  [READING]: "started reading",
  [WANTTOREAD]: "wants to read",
  [FINISHED]: "finished",
} as const;

/** DID of the @bookhive.buzz service account / site identity. */
export const BOOKHIVE_DID = "did:plc:enu2j5xjlqsjaylv3du4myh4";
