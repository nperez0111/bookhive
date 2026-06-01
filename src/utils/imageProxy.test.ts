import { describe, it, expect } from "bun:test";
import {
  parseImagePath,
  parseModifiers,
  modifiersToImgproxyOptions,
  isAllowedImageSource,
  signImgproxyPath,
  buildImgproxyUrl,
  coverImageUrl,
  avatarImageUrl,
} from "./imageProxy";

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
  it("returns empty string for no modifiers", () => {
    expect(modifiersToImgproxyOptions({})).toBe("");
  });

  it("maps width-only to a fit resize", () => {
    expect(modifiersToImgproxyOptions({ w: "440" })).toBe("rs:fit:440:0:0");
  });

  it("maps size + fit_cover to a fill resize", () => {
    expect(modifiersToImgproxyOptions({ s: "300x500", fit: "cover" })).toBe("rs:fill:300:500:0");
  });

  it("translates extend, background, quality and format", () => {
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

  it("normalizes jpg to jpeg but leaves other formats", () => {
    expect(modifiersToImgproxyOptions({ f: "webp" })).toBe("f:webp");
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
    // Reference vector verified against imgproxy's documented algorithm:
    // signature = urlsafe_base64(HMAC_SHA256(key, salt_bytes + path_bytes)).
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

  it("omits the options segment when there are no modifiers", () => {
    const url = buildImgproxyUrl("https://cdn.bsky.app/x", {}, config);
    const b64 = Buffer.from("https://cdn.bsky.app/x")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    // base / signature / b64  -> exactly 4 segments after the scheme
    expect(url).toBe(`http://imgproxy:8080/${signImgproxyPath(`/${b64}`, config)}/${b64}`);
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

describe("coverImageUrl", () => {
  it("returns a canonical /images path", () => {
    expect(coverImageUrl("https://i.gr-assets.com/books/1.jpg", { width: 440 })).toBe(
      "/images/w_440/https://i.gr-assets.com/books/1.jpg",
    );
  });

  it("prefixes the origin when provided", () => {
    expect(
      coverImageUrl("https://i.gr-assets.com/books/1.jpg", {
        width: 260,
        origin: "https://bookhive.buzz",
      }),
    ).toBe("https://bookhive.buzz/images/w_260/https://i.gr-assets.com/books/1.jpg");
  });

  it("returns undefined for falsy sources", () => {
    expect(coverImageUrl(null)).toBeUndefined();
    expect(coverImageUrl(undefined)).toBeUndefined();
    expect(coverImageUrl("")).toBeUndefined();
  });
});

describe("avatarImageUrl", () => {
  it("returns a square fit_cover /images path", () => {
    expect(avatarImageUrl("https://cdn.bsky.app/img/avatar/plain/x", { size: 120 })).toBe(
      "/images/s_120x120,fit_cover/https://cdn.bsky.app/img/avatar/plain/x",
    );
  });

  it("prefixes the origin when provided", () => {
    expect(
      avatarImageUrl("https://cdn.bsky.app/x", { size: 80, origin: "https://bookhive.buzz" }),
    ).toBe("https://bookhive.buzz/images/s_80x80,fit_cover/https://cdn.bsky.app/x");
  });

  it("returns undefined for falsy sources", () => {
    expect(avatarImageUrl(null)).toBeUndefined();
    expect(avatarImageUrl("")).toBeUndefined();
  });
});
