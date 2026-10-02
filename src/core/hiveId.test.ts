/**
 * Narrowing a wire value to a `HiveId`.
 *
 * The reason this module exists: `as HiveId` asserts the fact without checking
 * it, which is how `/books/null` reached the database.
 */
import { describe, it, expect } from "bun:test";
import { asHiveId, HIVE_ID_PATTERN, isHiveId } from "./hiveId";

describe("isHiveId", () => {
  it("accepts a well-formed id", () => {
    expect(isHiveId("bk_abc123")).toBe(true);
    expect(isHiveId("bk_A")).toBe(true);
  });

  it("rejects the values that actually turn up on the wire", () => {
    // Every one of these is something a route param or a JSON body has been
    // seen to carry.
    for (const bad of ["null", "undefined", "", "bk_", "abc", "BK_abc"]) {
      expect(isHiveId(bad)).toBe(false);
    }
  });

  it("accepts the NO_HIVE_MATCH sentinel, which is deliberately well-formed", () => {
    // `bk_none` has to pass: it is stored in `sync_document.hiveId`, so it must
    // be a syntactically valid id. Suppressing it is a *read* concern —
    // `src/data/syncDocuments.ts` turns it into `{hiveId: null, dismissed}` —
    // not something this validator should know about.
    expect(isHiveId("bk_none")).toBe(true);
  });

  it("rejects non-strings without throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(isHiveId(bad)).toBe(false);
    }
  });

  it("rejects an id with a separator, so it cannot smuggle a path segment", () => {
    expect(isHiveId("bk_abc/../etc")).toBe(false);
    expect(isHiveId("bk_abc def")).toBe(false);
    expect(isHiveId("bk_abc\n")).toBe(false);
  });

  it("is anchored at both ends", () => {
    expect(HIVE_ID_PATTERN.source.startsWith("^")).toBe(true);
    expect(HIVE_ID_PATTERN.source.endsWith("$")).toBe(true);
  });
});

describe("asHiveId", () => {
  it("returns the id when valid and null otherwise", () => {
    expect(asHiveId("bk_abc123")).toBe("bk_abc123");
    expect(asHiveId("null")).toBeNull();
    expect(asHiveId(undefined)).toBeNull();
  });

  it("gives a caller something to branch on rather than a lie", () => {
    // The point of the module: `"null" as HiveId` type-checks and reaches SQL.
    const fromWire: unknown = "null";
    const narrowed = asHiveId(fromWire);
    expect(narrowed).toBeNull();
  });
});
