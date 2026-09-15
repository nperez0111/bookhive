import { describe, it, test, expect } from "bun:test";
import { calculatePagination, pageOffset, pageWindow } from "./pagination";

describe("calculatePagination", () => {
  it("calculates values for the first page", () => {
    expect(calculatePagination(250, 100, 1)).toEqual({
      totalPages: 3,
      offset: 0,
      validPage: 1,
    });
  });

  it("calculates the offset for a middle page", () => {
    expect(calculatePagination(250, 100, 2)).toEqual({
      totalPages: 3,
      offset: 100,
      validPage: 2,
    });
  });

  it("handles a page size that divides evenly", () => {
    expect(calculatePagination(200, 100, 1).totalPages).toBe(2);
  });

  it("handles a single item", () => {
    expect(calculatePagination(1, 100, 1)).toMatchObject({ totalPages: 1, offset: 0 });
  });

  // "0 of 0" is not a page anyone can be on, and every caller renders
  // `page X of totalPages`, so an empty result set is one empty page.
  it("reports one page for an empty result set", () => {
    expect(calculatePagination(0, 100, 1)).toEqual({ totalPages: 1, offset: 0, validPage: 1 });
  });

  it("clamps a page below 1", () => {
    expect(calculatePagination(100, 10, -5)).toMatchObject({ validPage: 1, offset: 0 });
    expect(calculatePagination(100, 10, 0)).toMatchObject({ validPage: 1, offset: 0 });
  });

  // Without this an out-of-range `?page=` produced an OFFSET past the end and
  // an empty grid under a pager that highlighted a page that isn't there.
  it("clamps a page past the end", () => {
    expect(calculatePagination(100, 10, 99)).toMatchObject({ validPage: 10, offset: 90 });
  });

  it("ignores a non-numeric page", () => {
    expect(calculatePagination(100, 10, NaN).validPage).toBe(1);
  });
});

describe("pageWindow", () => {
  it("shows every page when they all fit", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pins to the start near the beginning", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, 5]);
  });

  it("centres on the current page in the middle", () => {
    expect(pageWindow(10, 20)).toEqual([8, 9, 10, 11, 12]);
  });

  it("pins to the end near the end", () => {
    expect(pageWindow(18, 20)).toEqual([16, 17, 18, 19, 20]);
    expect(pageWindow(20, 20)).toEqual([16, 17, 18, 19, 20]);
  });

  it("always includes the current page", () => {
    for (let total = 1; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        expect(pageWindow(page, total)).toContain(page);
      }
    }
  });
});

/**
 * `pageOffset` is what actually reaches the SQL, and it was untested while its
 * sibling `calculatePagination` was. Three of the six call sites it replaced
 * had forgotten the `Math.max(1, …)` floor and produced a negative OFFSET.
 */
describe("pageOffset", () => {
  test("page 1 starts at 0", () => {
    expect(pageOffset(1, 100)).toBe(0);
  });

  test("later pages step by pageSize", () => {
    expect(pageOffset(2, 100)).toBe(100);
    expect(pageOffset(4, 24)).toBe(72);
  });

  test("never negative, whatever the query string said", () => {
    // A negative OFFSET is a SQLite error, not an empty page — these are the
    // inputs a crawler produces.
    expect(pageOffset(0, 100)).toBe(0);
    expect(pageOffset(-3, 100)).toBe(0);
    expect(pageOffset(Number.NaN, 100)).toBe(0);
    expect(pageOffset(Number.NEGATIVE_INFINITY, 100)).toBe(0);
  });

  test("fractional pages floor rather than producing a fractional OFFSET", () => {
    expect(pageOffset(1.7, 100)).toBe(0);
    expect(pageOffset(2.9, 100)).toBe(100);
  });

  test("agrees with calculatePagination for any in-range page", () => {
    // The templates use one for the query and the other for the pager; if they
    // disagree the rendered page number does not match the rows shown.
    const total = 1_000;
    const size = 24;
    for (const page of [1, 2, 5, 41]) {
      expect(pageOffset(page, size)).toBe(calculatePagination(total, size, page).offset);
    }
  });
});
