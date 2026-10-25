import { afterEach, describe, it, expect, mock } from "bun:test";
import { env } from "../env";
import {
  coverImageUrl,
  avatarImageUrl,
  sourceCoverImageUrl,
  sourceAvatarImageUrl,
} from "../core/imageUrl";
import {
  parseImagePath,
  parseModifiers,
  modifiersToImgproxyOptions,
  isAllowedImageSource,
  signImgproxyPath,
  buildImgproxyUrl,
  queryToModifiers,
  proxyImageResponse,
} from "./imageProxy";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseImagePath", () => {
  it("splits modifiers from the source URL", () => {
    const { modifiersString, id } = parseImagePath(
      "/images/w_440/https://i.gr-assets.com/books/123.jpg",
    );
    expect(modifiersString).toBe("w_440");
    expect(id).toBe("https://i.gr-assets.com/books/123.jpg");
  });

  it("preserves the protocol double-slash when the client keeps it", () => {
    const { id } = parseImagePath("/images/w_440/https://cdn.bsky.app/img/avatar/plain/x");
    expect(id).toBe("https://cdn.bsky.app/img/avatar/plain/x");
  });

  it("restores a collapsed protocol slash (https:/host -> https://host)", () => {
    // Browsers/proxies collapse `//` after the protocol to a single `/`.
    const { id } = parseImagePath(
      "/images/s_160x160,fit_cover/https:/cdn.bsky.app/img/avatar/plain/did:plc:abc/cid",
    );
    expect(id).toBe("https://cdn.bsky.app/img/avatar/plain/did:plc:abc/cid");
  });

  it("restores a collapsed http (not just https) protocol slash", () => {
    const { id } = parseImagePath("/images/w_440/http:/i.gr-assets.com/books/1.jpg");
    expect(id).toBe("http://i.gr-assets.com/books/1.jpg");
  });

  it("does not add slashes when the protocol already has two", () => {
    const { id } = parseImagePath("/images/w_440/https://i.gr-assets.com/a/b/c.jpg");
    expect(id).toBe("https://i.gr-assets.com/a/b/c.jpg");
  });

  it("keeps the full path with colons in the source (bsky DIDs)", () => {
    const { id } = parseImagePath(
      "/images/s_120x120,fit_cover/https://cdn.bsky.app/img/avatar/plain/did:plc:7oyzfpde/bafkrei",
    );
    expect(id).toBe("https://cdn.bsky.app/img/avatar/plain/did:plc:7oyzfpde/bafkrei");
  });

  it("decodes percent-encoded source URLs", () => {
    const { id } = parseImagePath("/images/w_440/https%3A%2F%2Fi.gr-assets.com%2Fa%20b.jpg");
    expect(id).toBe("https://i.gr-assets.com/a b.jpg");
  });

  it("treats a missing modifier segment as none ('_')", () => {
    const { modifiersString, id } = parseImagePath("/images/_/https://i.gr-assets.com/x.jpg");
    expect(modifiersString).toBe("_");
    expect(id).toBe("https://i.gr-assets.com/x.jpg");
  });
});

describe("parseModifiers", () => {
  it("returns an empty map for '_' or empty", () => {
    expect(Object.keys(parseModifiers("_"))).toHaveLength(0);
    expect(Object.keys(parseModifiers(""))).toHaveLength(0);
  });

  it("parses a single width modifier", () => {
    expect(parseModifiers("w_440")).toEqual({ w: "440" });
  });

  it("parses comma-separated modifiers", () => {
    expect(parseModifiers("s_300x500,fit_cover,extend_5_5_5_5,b_030712")).toEqual({
      s: "300x500",
      fit: "cover",
      extend: "5_5_5_5",
      b: "030712",
    });
  });

  it("also splits on '&'", () => {
    expect(parseModifiers("w_440&q_80")).toEqual({ w: "440", q: "80" });
  });
});

describe("modifiersToImgproxyOptions", () => {
  it("defaults to webp output even with no modifiers", () => {
    expect(modifiersToImgproxyOptions({})).toBe("f:webp");
  });

  it("maps width-only to a fit resize and defaults to webp", () => {
    expect(modifiersToImgproxyOptions({ w: "440" })).toBe("rs:fit:440:0:0/f:webp");
  });

  it("maps size + fit_cover to a fill resize and defaults to webp", () => {
    expect(modifiersToImgproxyOptions({ s: "300x500", fit: "cover" })).toBe(
      "rs:fill:300:500:0/f:webp",
    );
  });

  it("translates extend, background, quality and an explicit format", () => {
    expect(
      modifiersToImgproxyOptions({
        s: "300x500",
        fit: "cover",
        extend: "5_5_5_5",
        b: "030712",
        q: "80",
        f: "jpg",
      }),
    ).toBe("rs:fill:300:500:0/ex:1/bg:030712/q:80/f:jpeg");
  });

  it("honors an explicit webp format", () => {
    expect(modifiersToImgproxyOptions({ f: "webp" })).toBe("f:webp");
  });

  it("lets an explicit format override the webp default", () => {
    expect(modifiersToImgproxyOptions({ f: "png" })).toBe("f:png");
    expect(modifiersToImgproxyOptions({ format: "jpg" })).toBe("f:jpeg");
  });
});

describe("isAllowedImageSource", () => {
  it("allows Goodreads and bsky hosts", () => {
    expect(isAllowedImageSource("https://i.gr-assets.com/books/1.jpg")).toBe(true);
    expect(isAllowedImageSource("https://cdn.bsky.app/img/avatar/plain/x")).toBe(true);
  });

  it("rejects non-allowlisted hosts", () => {
    expect(isAllowedImageSource("https://evil.example.com/x.jpg")).toBe(false);
    expect(isAllowedImageSource("https://books.google.com/x.jpg")).toBe(false);
  });

  it("rejects non-http(s) and relative/local paths", () => {
    expect(isAllowedImageSource("/default-avatar.png")).toBe(false);
    expect(isAllowedImageSource("ftp://i.gr-assets.com/x.jpg")).toBe(false);
    expect(isAllowedImageSource("")).toBe(false);
  });

  it("rejects a collapsed-protocol URL (must be repaired first)", () => {
    // This is why parseImagePath repairs the slash before the allowlist check.
    expect(isAllowedImageSource("https:/cdn.bsky.app/x")).toBe(false);
  });
});

describe("signImgproxyPath", () => {
  it("returns 'insecure' when key/salt are missing", () => {
    expect(signImgproxyPath("/rs:fit:440:0:0/abc", { key: "", salt: "" })).toBe("insecure");
  });

  it("matches the imgproxy reference signature vector", () => {
    // Verified against imgproxy's documented signing algorithm.
    const path = "/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1wbGUuY29tL2ltYWdlLmpwZw.png";
    const sig = signImgproxyPath(path, { key: "736563726574", salt: "68656C6C6F" });
    expect(sig).toBe("z6HVQx8EBGL9Y0tFucJ02s2THH8XhnY7hZc9lAiIJWE");
  });

  it("produces URL-safe base64 without padding", () => {
    const sig = signImgproxyPath("/abc", { key: "736563726574", salt: "68656C6C6F" });
    expect(sig).not.toContain("+");
    expect(sig).not.toContain("/");
    expect(sig).not.toContain("=");
  });
});

describe("buildImgproxyUrl", () => {
  const config = {
    baseUrl: "http://imgproxy:8080",
    key: "736563726574",
    salt: "68656C6C6F",
  };

  it("builds a signed base64-source URL with options", () => {
    const url = buildImgproxyUrl("https://i.gr-assets.com/books/1.jpg", { w: "440" }, config);
    // Shape: {base}/{sig}/{options}/{b64source}
    const b64 = Buffer.from("https://i.gr-assets.com/books/1.jpg")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(url.startsWith("http://imgproxy:8080/")).toBe(true);
    expect(url).toContain("/rs:fit:440:0:0/");
    expect(url.endsWith(`/${b64}`)).toBe(true);
  });

  it("includes the default webp format option when no modifiers are given", () => {
    const url = buildImgproxyUrl("https://cdn.bsky.app/x", {}, config);
    const b64 = Buffer.from("https://cdn.bsky.app/x")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const path = `/f:webp/${b64}`;
    // base / signature / f:webp / b64
    expect(url).toBe(`http://imgproxy:8080/${signImgproxyPath(path, config)}${path}`);
  });

  it("strips a trailing slash from the base url", () => {
    const url = buildImgproxyUrl(
      "https://cdn.bsky.app/x",
      {},
      {
        ...config,
        baseUrl: "http://imgproxy:8080/",
      },
    );
    expect(url.startsWith("http://imgproxy:8080/")).toBe(true);
    expect(url.startsWith("http://imgproxy:8080//")).toBe(false);
  });

  it("uses 'insecure' as the signature when signing is disabled", () => {
    const url = buildImgproxyUrl(
      "https://cdn.bsky.app/x",
      {},
      {
        baseUrl: "http://imgproxy:8080",
        key: "",
        salt: "",
      },
    );
    expect(url).toContain("/insecure/");
  });
});

describe("coverImageUrl (ID-keyed)", () => {
  it("returns a canonical /images/books/{hiveId} path", () => {
    expect(coverImageUrl("abc123")).toBe("/images/books/abc123");
  });

  it("appends ?w= when a width is given", () => {
    expect(coverImageUrl("abc123", { width: 440 })).toBe("/images/books/abc123?w=440");
  });

  it("url-encodes the hiveId", () => {
    expect(coverImageUrl("a/b c")).toBe("/images/books/a%2Fb%20c");
  });

  it("prefixes the origin when provided", () => {
    expect(coverImageUrl("abc123", { width: 260, origin: "https://bookhive.buzz" })).toBe(
      "https://bookhive.buzz/images/books/abc123?w=260",
    );
  });

  it("returns undefined for falsy ids", () => {
    expect(coverImageUrl(null)).toBeUndefined();
    expect(coverImageUrl(undefined)).toBeUndefined();
    expect(coverImageUrl("")).toBeUndefined();
  });
});

describe("avatarImageUrl (ID-keyed)", () => {
  it("returns a canonical /images/avatars/{did} path", () => {
    expect(avatarImageUrl("did:plc:abc")).toBe("/images/avatars/did%3Aplc%3Aabc");
  });

  it("appends ?s= when a size is given", () => {
    expect(avatarImageUrl("did:plc:abc", { size: 120 })).toBe(
      "/images/avatars/did%3Aplc%3Aabc?s=120",
    );
  });

  it("prefixes the origin when provided", () => {
    expect(avatarImageUrl("did:plc:abc", { size: 80, origin: "https://bookhive.buzz" })).toBe(
      "https://bookhive.buzz/images/avatars/did%3Aplc%3Aabc?s=80",
    );
  });

  it("returns undefined for falsy ids", () => {
    expect(avatarImageUrl(null)).toBeUndefined();
    expect(avatarImageUrl("")).toBeUndefined();
  });
});

describe("sourceCoverImageUrl (source-embedded)", () => {
  it("returns a /images/w_N/{source} path", () => {
    expect(sourceCoverImageUrl("https://i.gr-assets.com/books/1.jpg", { width: 440 })).toBe(
      "/images/w_440/https://i.gr-assets.com/books/1.jpg",
    );
  });

  it("prefixes the origin when provided", () => {
    expect(
      sourceCoverImageUrl("https://i.gr-assets.com/books/1.jpg", {
        width: 260,
        origin: "https://bookhive.buzz",
      }),
    ).toBe("https://bookhive.buzz/images/w_260/https://i.gr-assets.com/books/1.jpg");
  });

  it("returns undefined for falsy sources", () => {
    expect(sourceCoverImageUrl(null)).toBeUndefined();
    expect(sourceCoverImageUrl("")).toBeUndefined();
  });
});

describe("sourceAvatarImageUrl (source-embedded)", () => {
  it("returns a square fit_cover /images path", () => {
    expect(sourceAvatarImageUrl("https://cdn.bsky.app/img/avatar/plain/x", { size: 120 })).toBe(
      "/images/s_120x120,fit_cover/https://cdn.bsky.app/img/avatar/plain/x",
    );
  });

  it("returns undefined for falsy sources", () => {
    expect(sourceAvatarImageUrl(null)).toBeUndefined();
    expect(sourceAvatarImageUrl("")).toBeUndefined();
  });
});

describe("queryToModifiers", () => {
  it("uses defaults when no sizing query is present", () => {
    expect(queryToModifiers({}, { w: "440" })).toEqual({ w: "440" });
  });

  it("overrides defaults with query params", () => {
    expect(queryToModifiers({ w: "200", q: "80", fit: "cover" }, { w: "440" })).toEqual({
      w: "200",
      q: "80",
      fit: "cover",
    });
  });

  it("supports s/h overrides", () => {
    expect(queryToModifiers({ s: "300x500", h: "600" })).toEqual({ s: "300x500", h: "600" });
  });
});

describe("proxyImageResponse Goodreads repair", () => {
  const base = "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1562663148l/";
  const modifiers = { w: "440" };

  const sources: [string, string][] = [
    [`${base}51256920SY75_.jpg`, `${base}51256920._SY75_.jpg`],
    [`${base}51256920SY75_.jpg?v=%2f#cover`, `${base}51256920._SY75_.jpg?v=%2f#cover`],
    [`${base}51256920._SY75_.jpg`, `${base}51256920._SY75_.jpg`],
    [`${base}51256920.jpg`, `${base}51256920.jpg`],
    ["https://cdn.bsky.app/51256920SY75_.jpg", "https://cdn.bsky.app/51256920SY75_.jpg"],
    ["https://images.isbndb.com/51256920SY75_.jpg", "https://images.isbndb.com/51256920SY75_.jpg"],
    [
      "https://i.gr-assets.com/authors/51256920SY75_.jpg",
      "https://i.gr-assets.com/authors/51256920SY75_.jpg",
    ],
  ];

  for (const [source, expected] of sources) {
    it(`normalizes only recognized covers before signing or redirecting: ${source}`, async () => {
      const fetchMock = mock(
        async () =>
          new Response("image", { headers: { "Content-Type": "image/webp", ETag: '"cover"' } }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const response = await proxyImageResponse({
        source,
        modifiers,
        kind: "book",
        requestId: "test-cover",
        ifNoneMatch: '"previous"',
      });
      if (env.IMGPROXY_URL) {
        expect(fetchMock).toHaveBeenCalledWith(buildImgproxyUrl(expected, modifiers), {
          headers: { "If-None-Match": '"previous"' },
          signal: expect.any(AbortSignal),
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(200);
        expect(response.headers.get("ETag")).toBe('"cover"');
        expect(await response.text()).toBe("image");
      } else {
        expect(fetchMock).not.toHaveBeenCalled();
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(expected);
      }
    });
  }

  for (const source of [
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "i.gr-assets.com.evil.example"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "i.gr-assets.com@evil.example"),
    `${base}51256920SY75_.jpg`.replace("https:", "ftp:"),
    "/books/51256920SY75_.jpg",
  ]) {
    it(`still rejects forbidden sources without fetching: ${source}`, async () => {
      const fetchMock = mock(async () => new Response("unexpected"));
      const warn = mock(() => {});
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const response = await proxyImageResponse({
        source,
        modifiers,
        kind: "book",
        requestId: "test-forbidden",
        warn,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(warn).toHaveBeenCalledWith({ msg: "image_proxy_forbidden_source", image_id: source });
    });
  }

  it.skipIf(!env.IMGPROXY_URL)("does not retry an upstream 403", async () => {
    const fetchMock = mock(async () => new Response("Forbidden", { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const response = await proxyImageResponse({
      source: `${base}51256920SY75_.jpg`,
      modifiers,
      kind: "book",
      requestId: "test-upstream-error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});
