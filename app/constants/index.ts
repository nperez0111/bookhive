import type { BookStatus as SharedBookStatus } from "../../src/constants";

export {
  ABANDONED,
  FINISHED,
  READING,
  WANTTOREAD,
  BOOK_STATUS,
  BOOK_STATUS_MAP,
  BOOK_STATUS_PAST_TENSE_MAP,
} from "../../src/constants";

/** Native callbacks historically accept null to clear a reading status. */
export type BookStatus = SharedBookStatus | null;
