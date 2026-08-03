import { describe, it, expect } from "bun:test";

import {
  NO_STORE,
  PUBLIC_ERROR_HTML,
  PUBLIC_HTML,
  STATIC_ASSET_CACHE_CONTROL,
  cacheControlForHtml,
  hasSessionCookie,
  staticAssetCacheControl,
} from "./cacheHeaders";

describe("hasSessionCookie", () => {
  it("detects the iron-session cookie in any position", () => {
    expect(hasSessionCookie("sid=abc")).toBe(true);
    expect(hasSessionCookie("other=1; sid=abc")).toBe(true);
    expect(hasSessionCookie("other=1;sid=abc")).toBe(true);
  });

  it("is not fooled by cookies whose name merely ends in sid", () => {
    expect(hasSessionCookie("notsid=abc")).toBe(false);
    expect(hasSessionCookie("__cf_bm=x")).toBe(false);
  });

  it("treats a missing cookie header as anonymous", () => {
    expect(hasSessionCookie(undefined)).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });
});

describe("cacheControlForHtml", () => {
  it("never caches anything for a signed-in visitor, on any path", () => {
    for (const pathname of [
      "/",
      "/home",
      "/library",
      "/feed",
      "/search",
      "/profile/alice.bsky.social",
      "/books/bk_abc",
      "/explore",
      "/explore/genres/fantasy",
      "/authors/Tolkien",
      "/legal",
    ]) {
      expect(cacheControlForHtml({ pathname, hasSession: true, status: 200 })).toBe(NO_STORE);
    }
  });

  // The regression that would silently cost us Cloudflare offload on the
  // bot-heavy pages, which is the entire reason the anon page cache exists.
  it("keeps the public TTL for anonymous visitors on the cached route groups", () => {
    for (const pathname of [
      "/books/bk_abc",
      "/books/bk_abc/comments",
      "/explore",
      "/explore/genres/fantasy",
      "/authors/Tolkien",
    ]) {
      expect(cacheControlForHtml({ pathname, hasSession: false, status: 200 })).toBe(PUBLIC_HTML);
    }
  });

  it("caches anonymous error pages only briefly", () => {
    expect(
      cacheControlForHtml({ pathname: "/books/bk_nope", hasSession: false, status: 404 }),
    ).toBe(PUBLIC_ERROR_HTML);
    expect(cacheControlForHtml({ pathname: "/explore", hasSession: false, status: 500 })).toBe(
      PUBLIC_ERROR_HTML,
    );
  });

  // A redirect is not an error, and this function cannot see where it points —
  // stamping the error TTL on one would publicly cache a hop it knows nothing
  // about. Today no 3xx reaches here (Hono redirects carry no content-type, so
  // the nitro hook takes its non-HTML branch), which is exactly why this needs a
  // test: the guard is otherwise held up by a detail of a different file.
  it("leaves redirects to the route that issued them", () => {
    for (const status of [301, 302, 303, 307, 308]) {
      expect(cacheControlForHtml({ pathname: "/books/bk_moved", hasSession: false, status })).toBe(
        null,
      );
    }
  });

  it("defers to the route's own header for anonymous requests elsewhere", () => {
    for (const pathname of ["/", "/legal", "/search", "/login", "/profile/alice.bsky.social"]) {
      expect(cacheControlForHtml({ pathname, hasSession: false, status: 200 })).toBeNull();
    }
  });
});

describe("staticAssetCacheControl", () => {
  it("gives files under public/ a long TTL", () => {
    for (const pathname of [
      "/favicon.ico",
      "/book.svg",
      "/og-fallback.png",
      "/full_logo.jpg",
      "/site.webmanifest",
      "/hive-1280.webp",
      "/screenshots/comment.webp",
    ]) {
      expect(staticAssetCacheControl(pathname)).toBe(STATIC_ASSET_CACHE_CONTROL);
    }
  });

  it("ignores app routes, which is the bug the route rules had", () => {
    for (const pathname of ["/home", "/profile/alice", "/books/bk_abc", "/explore", "/"]) {
      expect(staticAssetCacheControl(pathname)).toBeNull();
    }
  });
});
