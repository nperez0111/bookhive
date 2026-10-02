/**
 * The reading-state transition, shared by the server write path and the
 * client's optimistic paint.
 *
 * This existed three times before (`inferBookStatusAndDates`, the re-read
 * rotation beside it, and `applyOptimistic`) and the client copy had drifted on
 * date anchoring. These tests pin the behaviour that all three now share.
 */
import { describe, it, expect } from "bun:test";
import { ABANDONED, FINISHED, READING, WANTTOREAD } from "../constants";
import { nextReadingState, readingDatesProblem, type ReadingState } from "./bookLifecycle";

const NOW = "2026-06-15T09:30:00.000Z";
const now = () => NOW;
const blank: ReadingState = {
  status: null,
  startedAt: null,
  finishedAt: null,
  previousReads: null,
};
const state = (over: Partial<ReadingState> = {}): ReadingState => ({ ...blank, ...over });

describe("date anchoring", () => {
  it("anchors a bare YYYY-MM-DD at noon UTC, not at the current time of day", () => {
    // The drift that shipped: the client anchored at `now.getUTCHours()`, so at
    // 02:00 UTC a reader at UTC−5 saw the *previous* day painted.
    const next = nextReadingState(blank, { finishedAt: "2026-03-15" }, { now });
    expect(next.finishedAt).toBe("2026-03-15T12:00:00.000Z");
  });

  it("anchors at the hour that preserves the calendar day for the most offsets", () => {
    // Noon is the maximum: it holds from UTC−12 to UTC+11 inclusive. It does
    // *not* hold at UTC+12..+14 (Kiritimati et al.), where 12:00Z is already
    // the next day — no single anchor can cover a 26-hour offset span, and
    // noon is the choice that covers the most of it.
    const iso = nextReadingState(blank, { startedAt: "2026-03-15" }, { now }).startedAt!;
    const at = (offsetHours: number) =>
      new Date(new Date(iso).getTime() + offsetHours * 3_600_000).getUTCDate();
    for (let offset = -12; offset <= 11; offset++) {
      expect(at(offset)).toBe(15);
    }
    expect(at(12)).toBe(16);
  });

  it("passes a full ISO datetime through untouched", () => {
    const next = nextReadingState(blank, { finishedAt: "2026-03-15T23:45:00.000Z" }, { now });
    expect(next.finishedAt).toBe("2026-03-15T23:45:00.000Z");
  });

  it("does not roll an impossible date forward", () => {
    // `Date.UTC(2026, 1, 31)` is 3 March. The client copy painted that; the
    // server returns the raw value so the caller's `datetime()` check rejects it.
    const next = nextReadingState(blank, { finishedAt: "2026-02-31" }, { now });
    expect(next.finishedAt).toBe("2026-02-31");
  });
});

describe("status inference", () => {
  it("infers Reading from a started date on an untracked or want-to-read book", () => {
    expect(nextReadingState(blank, { startedAt: "2026-03-01" }, { now }).status).toBe(READING);
    expect(
      nextReadingState(state({ status: WANTTOREAD }), { startedAt: "2026-03-01" }, { now }).status,
    ).toBe(READING);
  });

  it("infers Finished from a finished date on want-to-read or reading", () => {
    for (const from of [null, WANTTOREAD, READING]) {
      expect(
        nextReadingState(state({ status: from }), { finishedAt: "2026-03-01" }, { now }).status,
      ).toBe(FINISHED);
    }
  });

  it("does not downgrade a finished book when a date edit omits the status", () => {
    // The island posts only what changed. Reading a missing status as "none"
    // is what used to downgrade a finished book on a date edit.
    const next = nextReadingState(
      state({ status: FINISHED, finishedAt: "2026-01-01T12:00:00.000Z" }),
      { startedAt: "2025-12-01" },
      { now },
    );
    expect(next.status).toBe(FINISHED);
  });

  it("infers Reading from progress alone, but never over an explicit status", () => {
    expect(nextReadingState(blank, { bookProgress: { percent: 10 } }, { now }).status).toBe(
      READING,
    );
    expect(
      nextReadingState(blank, { bookProgress: { percent: 10 }, status: ABANDONED }, { now }).status,
    ).toBe(ABANDONED);
  });

  it("does not let progress resurrect a finished or abandoned book", () => {
    for (const from of [FINISHED, ABANDONED]) {
      expect(
        nextReadingState(state({ status: from }), { bookProgress: { percent: 10 } }, { now })
          .status,
      ).toBe(from);
    }
  });

  it("finishes complete page, chapter, and percent saves and stamps the finish date", () => {
    for (const bookProgress of [
      { currentPage: 658, totalPages: 658 },
      { currentChapter: 12, totalChapters: 12 },
      { percent: 100 },
    ]) {
      const next = nextReadingState(
        state({ status: READING, startedAt: "2026-01-01" }),
        { bookProgress },
        { now },
      );
      expect(next.status).toBe(FINISHED);
      expect(next.finishedAt).toBe(NOW);
      expect(next.startedAt).toBe("2026-01-01");
    }
  });

  it("does not finish a rounded-up percentage when exact counts remain incomplete", () => {
    for (const bookProgress of [
      { currentPage: 657, totalPages: 658, percent: 100 },
      { currentChapter: 199, totalChapters: 200, percent: 100 },
    ]) {
      const next = nextReadingState(state({ status: READING }), { bookProgress }, { now });
      expect(next.status).toBe(READING);
      expect(next.finishedAt).toBeNull();
    }
  });

  it("preserves explicit status choices and terminal dates on complete progress", () => {
    for (const status of [READING, ABANDONED, WANTTOREAD, FINISHED]) {
      expect(
        nextReadingState(blank, { status, bookProgress: { percent: 100 } }, { now }).status,
      ).toBe(status);
    }
    for (const status of [ABANDONED, FINISHED]) {
      const existing = state({ status, finishedAt: "2025-01-01" });
      expect(nextReadingState(existing, { bookProgress: { percent: 100 } }, { now })).toEqual(
        existing,
      );
    }
    const reread = nextReadingState(
      state({ status: FINISHED, finishedAt: "2025-01-01" }),
      { status: READING, bookProgress: { percent: 100 } },
      { now },
    );
    expect(reread.status).toBe(READING);
    expect(reread.finishedAt).toBeNull();
    expect(reread.previousReads).toHaveLength(1);
  });

  it("keeps inferred completion when a start date is saved in the same update", () => {
    const next = nextReadingState(
      blank,
      { bookProgress: { percent: 100 }, startedAt: "2026-01-01" },
      { now },
    );
    expect(next.status).toBe(FINISHED);
    expect(next.finishedAt).toBe(NOW);
  });

  it("leaves the status alone when the payload asserts nothing about it", () => {
    const next = nextReadingState(state({ status: READING }), {}, { now });
    expect(next.status).toBe(READING);
  });
});

describe("auto-stamping dates", () => {
  it("stamps a start date when a book enters Reading", () => {
    expect(nextReadingState(blank, { status: READING }, { now }).startedAt).toBe(NOW);
  });

  it("does not restamp a book already in that status", () => {
    // A rating save on an already-Reading book carries no dates and must not
    // move the ones it has.
    const existing = state({ status: READING, startedAt: "2020-01-01T12:00:00.000Z" });
    expect(nextReadingState(existing, { status: READING }, { now }).startedAt).toBe(
      "2020-01-01T12:00:00.000Z",
    );
  });

  it("stamps a finish date when a book enters Finished", () => {
    const existing = state({ status: READING, startedAt: "2026-01-01T12:00:00.000Z" });
    expect(nextReadingState(existing, { status: FINISHED }, { now }).finishedAt).toBe(NOW);
  });

  it("honours skipAutoDate, so an undated import row is not stamped with today", () => {
    const next = nextReadingState(blank, { status: FINISHED }, { now, skipAutoDate: true });
    expect(next.finishedAt).toBeNull();
    expect(next.status).toBe(FINISHED);
  });

  it("prefers a supplied date over the stamp", () => {
    const next = nextReadingState(blank, { status: READING, startedAt: "2026-02-02" }, { now });
    expect(next.startedAt).toBe("2026-02-02T12:00:00.000Z");
  });
});

describe("re-read rotation", () => {
  const finished = state({
    status: FINISHED,
    startedAt: "2020-01-01T12:00:00.000Z",
    finishedAt: "2020-02-01T12:00:00.000Z",
  });

  it("pushes the old pass into previousReads and resets", () => {
    const next = nextReadingState(finished, { status: READING }, { now });
    expect(next.status).toBe(READING);
    expect(next.startedAt).toBe(NOW);
    expect(next.finishedAt).toBeNull();
    expect(next.previousReads).toEqual([
      { startedAt: "2020-01-01T12:00:00.000Z", finishedAt: "2020-02-01T12:00:00.000Z" },
    ]);
  });

  it("keeps earlier passes, newest first", () => {
    const twice = state({
      ...finished,
      previousReads: [
        { startedAt: "2015-01-01T12:00:00.000Z", finishedAt: "2015-02-01T12:00:00.000Z" },
      ],
    });
    const next = nextReadingState(twice, { status: READING }, { now });
    expect(next.previousReads).toHaveLength(2);
    expect(next.previousReads![0]!.finishedAt).toBe("2020-02-01T12:00:00.000Z");
  });

  it("does not rotate a book that was never finished", () => {
    const reading = state({ status: READING, startedAt: "2026-01-01T12:00:00.000Z" });
    const next = nextReadingState(reading, { status: READING }, { now });
    expect(next.previousReads).toBeNull();
    expect(next.startedAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("clears finishedAt to null, not to the old value", () => {
    // The server used `""` as a clearing sentinel precisely because a falsy
    // value would otherwise fall back to the original.
    expect(nextReadingState(finished, { status: READING }, { now }).finishedAt).toBeNull();
  });
});

describe("readingDatesProblem", () => {
  it("rejects a finish before a start", () => {
    expect(
      readingDatesProblem({
        startedAt: "2026-03-10T12:00:00.000Z",
        finishedAt: "2026-03-01T12:00:00.000Z",
      }),
    ).toBe("Finished date must be on or after started date");
  });

  it("allows same-day", () => {
    expect(
      readingDatesProblem({
        startedAt: "2026-03-10T22:00:00.000Z",
        finishedAt: "2026-03-10T02:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("abstains when either date is missing", () => {
    expect(readingDatesProblem({ startedAt: null, finishedAt: "2026-03-01" })).toBeNull();
    expect(readingDatesProblem({ startedAt: "2026-03-01", finishedAt: null })).toBeNull();
  });
});
