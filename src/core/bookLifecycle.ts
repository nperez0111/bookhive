import { BOOK_STATUS } from "../constants";
import type { BookProgress, PreviousRead } from "../types";
import { statusFromProgress } from "./bookProgress";
import { dateInputToISO } from "../lib/dateInput";

/**
 * **The one** "given what the record already says and what this write asserts,
 * what are the new status and dates" — shared by the server write path and the
 * client's optimistic paint (`applyOptimistic`) so the two can't drift, as they
 * previously did over date anchoring.
 *
 * `now` is injectable so the optimistic path and a test can pin it; production
 * callers leave it alone.
 */

/** What the record already says. `null` means "not set". */
export type ReadingState = {
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  previousReads: PreviousRead[] | null;
};

/**
 * What this write asserts. `undefined` means "this payload says nothing about
 * it" — which is not the same as clearing it. The island posts only what
 * changed, so reading a missing status as "none" is what used to downgrade a
 * finished book to Reading on a date edit.
 */
export type ReadingWrite = {
  status?: string | undefined;
  /** Raw `<input type="date">` value or a full ISO datetime. */
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  /** Progress asserted by this write, never the unchanged stored progress. */
  bookProgress?: Omit<BookProgress, "updatedAt"> | null | undefined;
};

function assertedDate(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return dateInputToISO(value);
}

export function nextReadingState(
  existing: ReadingState,
  write: ReadingWrite,
  {
    /** Imports pass this so an undated source row is not stamped with today. */
    skipAutoDate = false,
    now = () => new Date().toISOString(),
  }: { skipAutoDate?: boolean; now?: () => string } = {},
): ReadingState {
  const startedInput = assertedDate(write.startedAt);
  const finishedInput = assertedDate(write.finishedAt);

  // Re-read: selecting "Reading" on an already-finished book pushes the
  // current dates into `previousReads` and resets startedAt/finishedAt.
  if (write.status === BOOK_STATUS.READING && existing.status === BOOK_STATUS.FINISHED) {
    return {
      status: BOOK_STATUS.READING,
      startedAt: now(),
      finishedAt: null,
      previousReads: existing.finishedAt
        ? [
            { startedAt: existing.startedAt ?? undefined, finishedAt: existing.finishedAt },
            ...(existing.previousReads ?? []),
          ]
        : existing.previousReads,
    };
  }

  // "unset" must mean unset on the *record*, not merely absent from this
  // payload.
  const currentStatus = write.status ?? existing.status;
  let status = write.status ?? null;

  // Recording progress means they are reading it, unless they've said otherwise.
  if (write.bookProgress && !write.status) {
    status = statusFromProgress(existing.status, write.bookProgress) ?? status;
  }
  if (
    startedInput &&
    status !== BOOK_STATUS.FINISHED &&
    (!currentStatus || currentStatus === BOOK_STATUS.WANTTOREAD)
  ) {
    status = BOOK_STATUS.READING;
  }
  if (
    finishedInput &&
    (!currentStatus ||
      currentStatus === BOOK_STATUS.WANTTOREAD ||
      currentStatus === BOOK_STATUS.READING)
  ) {
    status = BOOK_STATUS.FINISHED;
  }

  let startedAt = startedInput ?? existing.startedAt;
  let finishedAt = finishedInput ?? existing.finishedAt;

  // Stamp only when a book *enters* a status, not whenever it is in one.
  const alreadyReading = existing.status === BOOK_STATUS.READING && !!existing.startedAt;
  const alreadyFinished = existing.status === BOOK_STATUS.FINISHED && !!existing.finishedAt;
  if (!skipAutoDate) {
    if (status === BOOK_STATUS.READING && !startedInput && !alreadyReading) {
      startedAt = now();
    } else if (status === BOOK_STATUS.FINISHED && !finishedInput && !alreadyFinished) {
      finishedAt = now();
    }
  }

  return {
    status: status ?? existing.status,
    startedAt,
    finishedAt,
    previousReads: existing.previousReads,
  };
}

/**
 * The one bounds check on the pair, as a message rather than a throw — same
 * shape as `bookProgressProblem`. A bad date is user input, not a defect, and
 * throwing here used to render as a 500.
 */
export function readingDatesProblem(state: {
  startedAt: string | null;
  finishedAt: string | null;
}): string | null {
  if (!state.startedAt || !state.finishedAt) return null;
  const started = state.startedAt.split("T")[0]!;
  const finished = state.finishedAt.split("T")[0]!;
  return finished < started ? "Finished date must be on or after started date" : null;
}
