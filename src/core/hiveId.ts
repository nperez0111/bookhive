/**
 * What counts as a hive id, in one place.
 *
 * `HiveId` is a template literal type (`bk_${string}`), which the compiler can
 * check but a request body cannot satisfy — so every route that takes one from
 * the wire has to test it and then narrow. That test was written out twice
 * (`routes/books.tsx`, `routes/api.tsx`) and skipped entirely at ~8 other call
 * sites, which reached for `hiveId as HiveId` instead: a cast asserts the fact
 * without checking it, so `/books/null` reached the database as a lookup.
 */
import type { HiveId } from "../types";

/**
 * Hive ids are `bk_` + 20 base64url characters (see `getHiveId`). The character
 * class is deliberately wider than base64url so that older ids, and the
 * `bk_none` sentinel, still parse.
 */
export const HIVE_ID_PATTERN = /^bk_[A-Za-z0-9]+$/;

export function isHiveId(value: unknown): value is HiveId {
  return typeof value === "string" && HIVE_ID_PATTERN.test(value);
}

/**
 * Narrows a wire value to a `HiveId`, or `null` if it isn't one. Prefer this to
 * `as HiveId` anywhere the value came from a request, a CSV or another repo.
 */
export function asHiveId(value: unknown): HiveId | null {
  return isHiveId(value) ? value : null;
}
