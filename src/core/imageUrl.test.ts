import { describe, it, expect } from "bun:test";
import {
  avatarImageUrl,
  coverImageUrl,
  sourceAvatarImageUrl,
  sourceCoverImageUrl,
} from "./imageUrl";

describe("coverImageUrl / avatarImageUrl (ID-keyed, canonical)", () => {
  it("builds a site-relative path by default", () => {
    expect(coverImageUrl("bk_abc")).toBe("/images/books/bk_abc");
    expect(avatarImageUrl("did:plc:xyz")).toBe("/images/avatars/did%3Aplc%3Axyz");
  });

  it("takes a size hint on the query, not in the path", () => {
    expect(coverImageUrl("bk_abc", { width: 300 })).toBe("/images/books/bk_abc?w=300");
    expect(avatarImageUrl("did:plc:xyz", { size: 72 })).toBe(
      "/images/avatars/did%3Aplc%3Axyz?s=72",
    );
  });

  it("absolutises against an origin when one is given", () => {
    // Crawlers do not resolve relative image URLs, so `og:image` needs this.
    expect(coverImageUrl("bk_abc", { width: 440, origin: "https://bookhive.buzz" })).toBe(
      "https://bookhive.buzz/images/books/bk_abc?w=440",
    );
  });

  it("percent-encodes the id, so a DID's colons cannot split the path", () => {
    expect(avatarImageUrl("did:web:example.com")).toBe("/images/avatars/did%3Aweb%3Aexample.com");
  });

  it("returns undefined for a missing id rather than a broken URL", () => {
    // Callers spread this straight into `src`, so `undefined` must mean "render
    // the fallback", not "/images/books/null".
    for (const empty of [null, undefined, ""]) {
      expect(coverImageUrl(empty)).toBeUndefined();
      expect(avatarImageUrl(empty)).toBeUndefined();
    }
  });
});

describe("sourceCoverImageUrl / sourceAvatarImageUrl (source-embedded, stateless)", () => {
  it("embeds the source URL after the modifiers", () => {
    expect(sourceCoverImageUrl("https://img.example/x.jpg", { width: 200 })).toBe(
      "/images/w_200/https://img.example/x.jpg",
    );
  });

  it("defaults to the sizes the OG renderer and the app expect", () => {
    expect(sourceCoverImageUrl("https://img.example/x.jpg")).toContain("/images/w_440/");
    expect(sourceAvatarImageUrl("https://img.example/a.jpg")).toContain(
      "/images/s_120x120,fit_cover/",
    );
  });

  it("squares an avatar and crops to fill", () => {
    expect(sourceAvatarImageUrl("https://img.example/a.jpg", { size: 64 })).toBe(
      "/images/s_64x64,fit_cover/https://img.example/a.jpg",
    );
  });

  it("returns undefined for a missing source", () => {
    expect(sourceCoverImageUrl(null)).toBeUndefined();
    expect(sourceAvatarImageUrl("")).toBeUndefined();
  });
});
