import {
  ABANDONED,
  FINISHED,
  OWNED,
  READING,
  WANTTOREAD,
} from "./bsky/lexicon/types/buzz/bookhive/defs";

export const BOOK_STATUS_MAP = {
  [ABANDONED]: "abandoned",
  [READING]: "currently reading",
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
