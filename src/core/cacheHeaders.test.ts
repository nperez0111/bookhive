import { describe, expect, test } from "bun:test";

import { hasSessionCookie, isPublicallyCachedRoute } from "./cacheHeaders";

/**
 * Getting either of these wrong serves one user's personalised HTML to another,
 * so both are pinned rather than left to inspection. `cacheControlForHtml` was
 * already tested; its two inputs were not.
 */
describe("hasSessionCookie", () => {
  test("matches a real session cookie in any position", () => {
    expect(hasSessionCookie("sid=abc")).toBe(true);
    expect(hasSessionCookie("theme=dark; sid=abc")).toBe(true);
    expect(hasSessionCookie("theme=dark;sid=abc")).toBe(true);
  });

  test("does not match a cookie that merely ends in 'sid'", () => {
    // The anchor is the whole point: without it `nosid=` and `__Host-sid=` both
    // read as a session and every signed-out response goes uncacheable — or,
    // depending on which side you get wrong, a signed-in one gets cached.
    expect(hasSessionCookie("nosid=x")).toBe(false);
    expect(hasSessionCookie("__Host-sid=x")).toBe(false);
    expect(hasSessionCookie("mysid=x")).toBe(false);
  });

  test("absent or empty is false", () => {
    expect(hasSessionCookie(undefined)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("theme=dark")).toBe(false);
  });
});

describe("isPublicallyCachedRoute", () => {
  test("the three cached prefixes", () => {
    expect(isPublicallyCachedRoute("/books/bk_abc")).toBe(true);
    expect(isPublicallyCachedRoute("/explore")).toBe(true);
    expect(isPublicallyCachedRoute("/explore/genres")).toBe(true);
    expect(isPublicallyCachedRoute("/authors/Ursula%20K.%20Le%20Guin")).toBe(true);
  });

  test("a prefix must be a whole path segment", () => {
    // `/explore` is matched exactly *plus* `/explore/`. Collapsing those two
    // branches into a bare startsWith("/explore") is the obvious tidy-up, and
    // it would start caching any future `/exploreme`.
    expect(isPublicallyCachedRoute("/exploreme")).toBe(false);
    expect(isPublicallyCachedRoute("/books")).toBe(false);
    expect(isPublicallyCachedRoute("/authors")).toBe(false);
  });

  test("personalised routes are never publicly cached", () => {
    expect(isPublicallyCachedRoute("/home")).toBe(false);
    expect(isPublicallyCachedRoute("/profile/alice")).toBe(false);
    expect(isPublicallyCachedRoute("/feed")).toBe(false);
    expect(isPublicallyCachedRoute("/")).toBe(false);
  });
});
