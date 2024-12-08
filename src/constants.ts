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
