/**
 * The pure half of `personalBooks.ts` — the row → wire shaping that four XRPC
 * methods and two OPDS renderers all go through.
 *
 * The cover precedence is the reason this is tested rather than eyeballed: it
 * used to differ between transports, so the same file showed the catalogue's
 * stock thumbnail in the iOS app and the user's own cover on their e-reader.
 */
import { describe, it, expect } from "bun:test";
import { personalBookView, personalCoverUrl, type PersonalBookRowWithHive } from "./personalBooks";

const row = (over: Partial<PersonalBookRowWithHive> = {}): PersonalBookRowWithHive => ({
  id: 1,
  contentHash: "abc123",
  hiveId: null,
  filename: "Dune.epub",
  title: "Dune",
  authors: "Frank Herbert",
  language: "en",
  format: "epub",
  mime: "application/epub+zip",
  filePath: "/lib/abc123/Dune.epub",
  epubPath: null,
  coverPath: null,
  coverMime: null,
  sizeBytes: 1234,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...over,
});

describe("personalCoverUrl", () => {
  it("prefers the user's own extracted cover over the catalogue's", () => {
    // The reason `prepareCover` rasterizes Standard Ebooks' SVG covers — local must win over the catalogue's stock thumbnail.
    expect(
      personalCoverUrl(
        row({ coverPath: "/lib/abc123/cover.jpg", hiveBookCover: "https://cat/cover.jpg" }),
      ),
    ).toBe("/library/covers/abc123");
  });

  it("falls back to the catalogue cover, then its thumbnail", () => {
    expect(personalCoverUrl(row({ hiveBookCover: "https://cat/c.jpg" }))).toBe("https://cat/c.jpg");
    expect(personalCoverUrl(row({ hiveBookThumbnail: "https://cat/t.jpg" }))).toBe(
      "https://cat/t.jpg",
    );
  });

  it("is undefined when there is no cover anywhere", () => {
    expect(personalCoverUrl(row())).toBeUndefined();
  });
});

describe("personalBookView", () => {
  it("reports hasLocalCover alongside coverUrl", () => {
    // `coverUrl`'s local form needs a session cookie, which a service-auth client does not have — the flag is how such a client knows to call getPersonalBookCover instead.
    const view = personalBookView(row({ coverPath: "/lib/abc123/cover.jpg" }));
    expect(view.coverUrl).toBe("/library/covers/abc123");
    expect(view.hasLocalCover).toBe(true);
  });

  it("reports hasLocalCover false for a catalogue-only cover", () => {
    const view = personalBookView(row({ hiveBookCover: "https://cat/c.jpg" }));
    expect(view.coverUrl).toBe("https://cat/c.jpg");
    expect(view.hasLocalCover).toBe(false);
  });

  it("answers with the file's own title and authors", () => {
    const view = personalBookView(row());
    expect(view.title).toBe("Dune");
    expect(view.authors).toBe("Frank Herbert");
    expect(view.filename).toBe("Dune.epub");
  });

  it("maps SQL nulls to undefined so they drop out of the JSON body", () => {
    const view = personalBookView(row({ authors: null, language: null, hiveId: null }));
    expect(view.authors).toBeUndefined();
    expect(view.language).toBeUndefined();
    expect(view.hiveId).toBeUndefined();
  });

  it("omits progress and shelfIds entirely when the caller did not load them", () => {
    // `getPersonalBook` selects neither; emitting `progress: undefined` would
    // put a key in the object that the lexicon output type does not have.
    const view = personalBookView(row());
    expect(view).not.toHaveProperty("progress");
    expect(view).not.toHaveProperty("shelfIds");
  });

  it("includes them when they are supplied, including empty shelf membership", () => {
    const view = personalBookView(row(), { shelfIds: [], progress: undefined });
    expect(view.shelfIds).toEqual([]);
    expect(view).not.toHaveProperty("progress");
  });

  it("never leaks the on-disk paths", () => {
    const view = personalBookView(
      row({ coverPath: "/lib/x/cover.jpg", epubPath: "/lib/x/d.epub" }),
    );
    expect(JSON.stringify(view)).not.toContain("/lib/");
  });
});
