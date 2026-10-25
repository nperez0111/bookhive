import { describe, expect, it } from "bun:test";
import { normalizeGoodreadsCoverUrl } from "./goodreadsCoverUrl";

const base = "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1562663148l/";

describe("normalizeGoodreadsCoverUrl", () => {
  for (const size of ["SX50_", "SY75_", "UX100_", "UY200_"]) {
    it(`repairs the historical glued ${size} suffix`, () => {
      expect(normalizeGoodreadsCoverUrl(`${base}51256920${size}.jpg`)).toBe(
        `${base}51256920._${size}.jpg`,
      );
      expect(normalizeGoodreadsCoverUrl(`${base}51256920${size}.jpg`, { fullSize: true })).toBe(
        `${base}51256920.jpg`,
      );
    });

    it(`preserves valid ${size} thumbnails unless full size is requested`, () => {
      const source = `${base}51256920._${size}.jpg`;
      expect(normalizeGoodreadsCoverUrl(source)).toBe(source);
      expect(normalizeGoodreadsCoverUrl(source, { fullSize: true })).toBe(`${base}51256920.jpg`);
    });
  }

  it("preserves query strings and fragments verbatim", () => {
    const tail = "?a=one+two&b=%2f&b=two&url=123SY75_.jpg#51256920SY75_.jpg";
    expect(normalizeGoodreadsCoverUrl(`${base}51256920SY75_.jpg${tail}`)).toBe(
      `${base}51256920._SY75_.jpg${tail}`,
    );
    expect(
      normalizeGoodreadsCoverUrl(`${base}51256920._SY75_.jpg${tail}`, { fullSize: true }),
    ).toBe(`${base}51256920.jpg${tail}`);
  });

  it("handles the legacy Goodreads book path without upgrading HTTP", () => {
    expect(
      normalizeGoodreadsCoverUrl("http://i.gr-assets.com/books/1562663148l/51256920SY75_.jpg"),
    ).toBe("http://i.gr-assets.com/books/1562663148l/51256920._SY75_.jpg");
  });

  const unchanged = [
    `${base}51256920.jpg`,
    `${base}51256920.jpg?size=51256920SY75_.jpg`,
    `${base}51256920._SX50_SY75_.jpg`,
    `${base}51256920._UX100_CR0,0,100,100_.jpg`,
    `${base}51256920AB75_.jpg`,
    `${base}titleSY75_.jpg`,
    `${base}51256920SY75_.png`,
    `${base}51256920SY75_.jpg/another.jpg`,
    `${base}51256920SY75_.jpg`.replace("/books/", "/users/"),
    `${base}51256920SY75_.jpg`.replace("/books/", "/authors/"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "i.gr-assets.com.evil.example"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "evil.example/i.gr-assets.com"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "i.gr-assets.com@evil.example"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "evil.example@i.gr-assets.com"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "cdn.bsky.app"),
    `${base}51256920SY75_.jpg`.replace("i.gr-assets.com", "images.isbndb.com"),
    `${base}51256920SY75_.jpg`.replace("https:", "ftp:"),
    "/books/1562663148l/51256920SY75_.jpg",
    "not a URL",
    "",
  ];
  for (const source of unchanged) {
    it(`leaves unrelated, valid or unrecognized sources untouched: ${source}`, () => {
      expect(normalizeGoodreadsCoverUrl(source)).toBe(source);
      expect(normalizeGoodreadsCoverUrl(source, { fullSize: true })).toBe(source);
    });
  }

  it("is idempotent", () => {
    const source = `${base}51256920SY75_.jpg`;
    const repaired = normalizeGoodreadsCoverUrl(source);
    expect(normalizeGoodreadsCoverUrl(repaired)).toBe(repaired);
  });
});
