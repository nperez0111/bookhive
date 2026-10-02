import { describe, expect, test } from "bun:test";

import { hydrateUserBook, serializeUserBook } from "./bookProgress";

/**
 * `hydrateUserBook` is on the read path of `/books/:id`, `/home`, `/feed`, the
 * profile page, both OG cards and four XRPC methods. `bookProgress` used to be
 * a bare `JSON.parse` while `previousReads` and `record` beside it were
 * guarded, so one malformed blob 500'd all of them at once.
 */
describe("hydrateUserBook", () => {
  const row = { bookProgress: null as string | null, previousReads: null as string | null };

  test("malformed bookProgress is null, not a throw", () => {
    expect(() => hydrateUserBook({ ...row, bookProgress: "{not json" })).not.toThrow();
    expect(hydrateUserBook({ ...row, bookProgress: "{not json" }).bookProgress).toBeNull();
  });

  test("JSON that parses to a non-object is rejected", () => {
    // `JSON.parse` succeeds for all of these; each would otherwise be handed to
    // every reader typed as a `BookProgress`.
    expect(hydrateUserBook({ ...row, bookProgress: "null" }).bookProgress).toBeNull();
    expect(hydrateUserBook({ ...row, bookProgress: "[]" }).bookProgress).toBeNull();
    expect(hydrateUserBook({ ...row, bookProgress: "42" }).bookProgress).toBeNull();
    expect(hydrateUserBook({ ...row, bookProgress: '"a string"' }).bookProgress).toBeNull();
  });

  test("a well-formed blob comes through", () => {
    const parsed = hydrateUserBook({
      ...row,
      bookProgress: '{"percent":42,"currentPage":10,"totalPages":24}',
    }).bookProgress;
    expect(parsed).toEqual({ percent: 42, currentPage: 10, totalPages: 24 } as never);
  });

  test("previousReads that parses to a non-array is null", () => {
    expect(hydrateUserBook({ ...row, previousReads: "{}" }).previousReads).toBeNull();
    expect(hydrateUserBook({ ...row, previousReads: "garbage" }).previousReads).toBeNull();
  });

  test("a missing record column is null rather than undefined", () => {
    expect(hydrateUserBook(row).record).toBeNull();
  });
});

describe("serializeUserBook", () => {
  test("round-trips a fully populated row", () => {
    const stored = {
      bookProgress: '{"percent":50}',
      previousReads: '[{"finishedAt":"2025-01-01"}]',
      record: '{"$type":"buzz.bookhive.book"}',
    };
    expect(serializeUserBook(hydrateUserBook(stored))).toEqual(stored);
  });

  test("an empty previousReads array stores as NULL, not '[]'", () => {
    // Deliberately asymmetric — pinned so nobody 'fixes' it into a round-trip.
    expect(
      serializeUserBook({ bookProgress: null, previousReads: [], record: null }).previousReads,
    ).toBeNull();
  });

  test("nulls stay null", () => {
    expect(serializeUserBook({ bookProgress: null, previousReads: null, record: null })).toEqual({
      bookProgress: null,
      previousReads: null,
      record: null,
    });
  });
});
