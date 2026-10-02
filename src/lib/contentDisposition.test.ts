/**
 * `Content-Disposition` construction.
 *
 * Every case here is one the module's own docstring calls out as having gone
 * wrong or being easy to get wrong. Getting this wrong is silent — a valid 200
 * carrying the right bytes, and the file lands under the wrong name — so it is
 * exactly the sort of thing that needs a test rather than a review.
 */
import { describe, it, expect } from "bun:test";
import { attachmentDisposition } from "./contentDisposition";

describe("attachmentDisposition", () => {
  it("emits both parameter forms", () => {
    // `filename*` alone is not enough: a client that implements only the plain
    // `filename` would otherwise fall back to the URL's last path segment.
    const value = attachmentDisposition("Dune.epub", "Dune.epub");
    expect(value).toBe(`attachment; filename="Dune.epub"; filename*=UTF-8''Dune.epub`);
  });

  it("percent-encodes an apostrophe, which is the ext-value's own delimiter", () => {
    // The regression that shipped: `encodeURIComponent` leaves `'` alone, so
    // `UTF-8''The%20Handmaid's%20Tale.epub` parses as language `The%20Handmaid`
    // and filename `s%20Tale.epub`.
    const value = attachmentDisposition("The Handmaid's Tale.epub", "The_Handmaids_Tale.epub");
    expect(value).toContain("filename*=UTF-8''The%20Handmaid%27s%20Tale.epub");
    expect(value.split("filename*=UTF-8''")[1]).not.toContain("'");
  });

  it("percent-encodes the non-attr-chars encodeURIComponent leaves bare", () => {
    // Of the six `encodeURIComponent` misses (`' ( ) * ! ~`), four are not
    // attr-chars and must be escaped. `!` and `~` are attr-chars and stay bare.
    const ext = attachmentDisposition("a( )*b.epub", "ab.epub").split("filename*=UTF-8''")[1]!;
    expect(ext).toBe("a%28%20%29%2Ab.epub");
  });

  it("encodes non-ASCII as UTF-8 bytes", () => {
    const value = attachmentDisposition("Caf\u00e9.epub", "Cafe.epub");
    // \u00e9 is U+00E9 -> C3 A9 in UTF-8, one percent-escape per byte.
    expect(value).toContain("filename*=UTF-8''Caf%C3%A9.epub");
  });

  it("leaves attr-chars unescaped", () => {
    const value = attachmentDisposition("a-b_c.d~e!f.epub", "a-b_c.d~e!f.epub");
    expect(value).toContain("filename*=UTF-8''a-b_c.d~e!f.epub");
  });

  it("escapes a quote in the plain filename rather than closing the string early", () => {
    // The plain parameter is a quoted-string. An unescaped `"` would let a
    // caller close it and append parameters of its own.
    const value = attachmentDisposition("x.epub", 'ev"il.epub');
    expect(value).toContain('filename="ev\\"il.epub"');
  });

  it("escapes a backslash in the plain filename", () => {
    const value = attachmentDisposition("x.epub", "a\\b.epub");
    expect(value).toContain('filename="a\\\\b.epub"');
  });

  it("drops control characters from the plain filename", () => {
    // A bare CR or LF in a header value is response splitting, and a
    // quoted-string cannot escape it.
    const value = attachmentDisposition("x.epub", "a\r\nSet-Cookie: b.epub");
    expect(value).not.toContain("\r");
    expect(value).not.toContain("\n");
    expect(value).toContain('filename="aSet-Cookie: b.epub"');
  });

  it("keeps the two names independent, so the URL segment can differ from the real title", () => {
    // `asciiName` is the same string the download URL ends in, so a client that
    // reads the header and one that scrapes the URL agree byte for byte.
    const value = attachmentDisposition("Los Detectives Salvajes.epub", "Los_Detectives.epub");
    expect(value).toContain('filename="Los_Detectives.epub"');
    expect(value).toContain("filename*=UTF-8''Los%20Detectives%20Salvajes.epub");
  });
});
