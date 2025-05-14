/** User has finished reading the book */
export const FINISHED = "buzz.bookhive.defs#finished";
/** User is currently reading the book */
export const READING = "buzz.bookhive.defs#reading";
/** User wants to read the book */
export const WANTTOREAD = "buzz.bookhive.defs#wantToRead";
/** User has abandoned the book */
export const ABANDONED = "buzz.bookhive.defs#abandoned";
/** User owns the book */
export const OWNED = "buzz.bookhive.defs#owned";

export type BookStatus = (typeof BOOK_STATUS)[keyof typeof BOOK_STATUS] | null;

export const BOOK_STATUS = {
  ABANDONED,
  READING,
  WANTTOREAD,
  OWNED,
  FINISHED,
} as const;

export const BOOK_STATUS_MAP = {
  [ABANDONED]: "abandoned",
  [READING]: "reading",
  [WANTTOREAD]: "want to read",
  [OWNED]: "owned",
  [FINISHED]: "read",
} as const;

export const BOOK_STATUS_PAST_TENSE_MAP = {
  [ABANDONED]: "marked this book as abandoned",
  [READING]: "is reading this book",
  [WANTTOREAD]: "wants to read this book",
  [OWNED]: "owns this book",
  [FINISHED]: "has read this book",
} as const;
