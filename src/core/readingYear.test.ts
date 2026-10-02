import { describe, expect, test } from "bun:test";

import { BOOK_STATUS } from "../constants";
import {
  booksFinishedInYear,
  monthStartIso,
  timesFinishedInYear,
  utcYearOf,
  yearStartIso,
} from "./readingYear";

describe("utcYearOf", () => {
  test("is UTC, not local — the whole reason this module exists", () => {
    // 02:00Z on 1 January is the previous year everywhere west of UTC, which is
    // how `/profile` and the OG card came to disagree about the same book.
    expect(utcYearOf("2026-01-01T02:00:00.000Z")).toBe(2026);
    // And the mirror case: 23:00Z on 31 December is *next* year east of UTC.
    expect(utcYearOf("2025-12-31T23:00:00.000Z")).toBe(2025);
  });

  test("absent and unparseable are null, not NaN or 1970", () => {
    expect(utcYearOf(null)).toBeNull();
    expect(utcYearOf(undefined)).toBeNull();
    expect(utcYearOf("")).toBeNull();
    expect(utcYearOf("not a date")).toBeNull();
  });
});

describe("yearStartIso / monthStartIso", () => {
  test("year start is midnight UTC on 1 January", () => {
    expect(yearStartIso(2026)).toBe("2026-01-01T00:00:00.000Z");
  });

  test("month start uses the UTC month, not the local one", () => {
    // 2026-02-01T00:30Z is still January in any negative offset.
    expect(monthStartIso(new Date("2026-02-01T00:30:00.000Z"))).toBe("2026-02-01T00:00:00.000Z");
  });

  test("both sort correctly against a finishedAt string", () => {
    expect("2026-03-04T12:00:00.000Z" >= yearStartIso(2026)).toBe(true);
    expect("2025-12-31T23:59:59.999Z" >= yearStartIso(2026)).toBe(false);
  });
});

describe("timesFinishedInYear", () => {
  test("a finished book in the year counts once", () => {
    expect(
      timesFinishedInYear(
        { status: BOOK_STATUS.FINISHED, finishedAt: "2026-05-01T00:00:00.000Z" },
        2026,
      ),
    ).toBe(1);
  });

  test("the current read only counts when the book is actually finished", () => {
    // A re-read in progress has a stale `finishedAt` of null and status
    // Reading; nothing about it should count toward this year.
    expect(
      timesFinishedInYear(
        { status: BOOK_STATUS.READING, finishedAt: "2026-05-01T00:00:00.000Z" },
        2026,
      ),
    ).toBe(0);
  });

  test("re-reads count — the disagreement between the profile and its OG card", () => {
    expect(
      timesFinishedInYear(
        {
          status: BOOK_STATUS.FINISHED,
          finishedAt: "2026-09-01T00:00:00.000Z",
          previousReads: [{ finishedAt: "2026-02-01T00:00:00.000Z" }],
        },
        2026,
      ),
    ).toBe(2);
  });

  test("a previousRead counts even while the book is being read again", () => {
    // `bookLifecycle` clears `finishedAt` and archives the completed pass when
    // a Finished book is set back to Reading. That pass still happened.
    expect(
      timesFinishedInYear(
        {
          status: BOOK_STATUS.READING,
          finishedAt: null,
          previousReads: [{ finishedAt: "2026-02-01T00:00:00.000Z" }],
        },
        2026,
      ),
    ).toBe(1);
  });

  test("reads in other years are excluded", () => {
    expect(
      timesFinishedInYear(
        {
          status: BOOK_STATUS.FINISHED,
          finishedAt: "2025-09-01T00:00:00.000Z",
          previousReads: [{ finishedAt: "2024-02-01T00:00:00.000Z" }],
        },
        2026,
      ),
    ).toBe(0);
  });

  test("null previousReads and entries without a finishedAt are ignored", () => {
    expect(timesFinishedInYear({ status: BOOK_STATUS.FINISHED, finishedAt: null }, 2026)).toBe(0);
    expect(
      timesFinishedInYear(
        { status: BOOK_STATUS.FINISHED, finishedAt: null, previousReads: [{ finishedAt: null }] },
        2026,
      ),
    ).toBe(0);
  });
});

describe("booksFinishedInYear", () => {
  test("sums reads, not books", () => {
    const books = [
      {
        status: BOOK_STATUS.FINISHED,
        finishedAt: "2026-01-05T00:00:00.000Z",
        previousReads: [{ finishedAt: "2026-06-01T00:00:00.000Z" }],
      },
      { status: BOOK_STATUS.FINISHED, finishedAt: "2026-07-01T00:00:00.000Z" },
      { status: BOOK_STATUS.WANTTOREAD, finishedAt: null },
    ];
    expect(booksFinishedInYear(books, 2026)).toBe(3);
  });

  test("an empty shelf is zero", () => {
    expect(booksFinishedInYear([], 2026)).toBe(0);
  });
});
