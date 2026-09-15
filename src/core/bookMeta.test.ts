import { describe, it, expect } from "bun:test";
import { normalizeBookMeta } from "./bookMeta";

describe("normalizeBookMeta", () => {
  it("returns empty object for null/undefined/empty", () => {
    expect(normalizeBookMeta(null)).toEqual({});
    expect(normalizeBookMeta(undefined)).toEqual({});
    expect(normalizeBookMeta("")).toEqual({});
  });

  it("returns empty object for malformed JSON", () => {
    expect(normalizeBookMeta("{broken")).toEqual({});
    expect(normalizeBookMeta("not json")).toEqual({});
  });

  it("returns empty object for non-object JSON", () => {
    expect(normalizeBookMeta('"hello"')).toEqual({});
    expect(normalizeBookMeta("[1,2,3]")).toEqual({});
    expect(normalizeBookMeta("42")).toEqual({});
  });

  describe("real database rows", () => {
    it("parses a fully-populated book (Introduction to Algorithms)", () => {
      const meta = JSON.stringify({
        publisher: "Mit Pr",
        publicationYear: 2001,
        language: "English",
        isbn: "0262032937",
        isbn13: "9780262032933",
        authorBio:
          "Thomas H. Cormen is the co-author of Introduction to Algorithms, along with Charles Leiserson, Ron Rivest, and Cliff Stein.",
        secondaryAuthors: [
          { name: "Charles E. Leiserson", role: "Author" },
          { name: "Ronald L. Rivest", role: "Author" },
          { name: "Clifford Stein", role: "Author" },
        ],
        ratingsDistribution: [105, 231, 1073, 2781, 5144],
        numPages: 1184,
      });

      const result = normalizeBookMeta(meta);
      expect(result.publisher).toBe("Mit Pr");
      expect(result.publicationYear).toBe(2001);
      expect(result.language).toBe("English");
      expect(result.numPages).toBe(1184);
      expect(result.authorBio).toContain("Thomas H. Cormen");
      expect(result.secondaryAuthors).toHaveLength(3);
      expect(result.secondaryAuthors![0]).toEqual({
        name: "Charles E. Leiserson",
        role: "Author",
      });
      expect(result.ratingsDistribution).toEqual([105, 231, 1073, 2781, 5144]);
    });

    it("parses a book with empty publisher and authorBio", () => {
      const meta = JSON.stringify({
        publisher: "",
        publicationYear: 2013,
        language: "Czech",
        isbn13: "9788074561757",
        authorBio: "",
        secondaryAuthors: [{ name: "Jana Vybíralová", role: "Author" }],
        ratingsDistribution: [0, 5, 9, 40, 99],
        numPages: 504,
      });

      const result = normalizeBookMeta(meta);
      expect(result.publisher).toBeUndefined();
      expect(result.authorBio).toBeUndefined();
      expect(result.publicationYear).toBe(2013);
      expect(result.language).toBe("Czech");
      expect(result.numPages).toBe(504);
      expect(result.secondaryAuthors).toEqual([{ name: "Jana Vybíralová", role: "Author" }]);
      expect(result.ratingsDistribution).toEqual([0, 5, 9, 40, 99]);
    });

    it("parses a book with empty language and empty secondaryAuthors", () => {
      const meta = JSON.stringify({
        publisher: "Hill and Wang",
        publicationYear: 2006,
        language: "",
        isbn: "0809045990",
        isbn13: "9780809045990",
        authorBio: "William Poundstone is the author of more than ten non-fiction books.",
        secondaryAuthors: [],
        ratingsDistribution: [50, 151, 724, 1638, 2011],
        numPages: 386,
      });

      const result = normalizeBookMeta(meta);
      expect(result.language).toBeUndefined();
      expect(result.secondaryAuthors).toBeUndefined();
      expect(result.publisher).toBe("Hill and Wang");
      expect(result.numPages).toBe(386);
    });

    it("parses a book with no isbn fields (only standard meta)", () => {
      const meta = JSON.stringify({
        publisher: "Vintage",
        publicationYear: 2024,
        language: "English",
        authorBio: "",
        secondaryAuthors: [],
        ratingsDistribution: [96, 438, 1662, 1992, 935],
        numPages: 290,
      });

      const result = normalizeBookMeta(meta);
      expect(result.publisher).toBe("Vintage");
      expect(result.publicationYear).toBe(2024);
      expect(result.numPages).toBe(290);
      expect(result.authorBio).toBeUndefined();
      expect(result.secondaryAuthors).toBeUndefined();
    });

    it("parses a book with HTML in authorBio", () => {
      const meta = JSON.stringify({
        publisher: "Fawcett",
        publicationYear: 1986,
        language: "English",
        isbn: "0449213501",
        isbn13: "9780449213506",
        authorBio:
          'Oliver Napoleon Hill was an American self-help author and conman. He is best known for his book Think and Grow Rich (1937). <a href="https://www.goodreads.com/author/show/23387._Andrew_Carnegie" title=" Andrew Carnegie" rel="nofollow noopener"> Andrew Carnegie</a>',
        secondaryAuthors: [],
        ratingsDistribution: [124, 228, 805, 1523, 3189],
        numPages: 208,
      });

      const result = normalizeBookMeta(meta);
      expect(result.authorBio).toContain("<a href=");
      expect(result.authorBio).toContain("Andrew Carnegie");
      expect(result.publisher).toBe("Fawcett");
    });

    it("handles a massively popular book (Fourth Wing)", () => {
      const meta = JSON.stringify({
        publisher: "Entangled: Red Tower Books",
        publicationYear: 2023,
        language: "English",
        isbn: "1649374046",
        isbn13: "9781649374042",
        authorBio: "Rebecca Yarros is a hopeless romantic and coffee addict.",
        secondaryAuthors: [],
        ratingsDistribution: [32948, 66383, 234596, 776607, 2539301],
        numPages: 517,
      });

      const result = normalizeBookMeta(meta);
      expect(result.ratingsDistribution).toEqual([32948, 66383, 234596, 776607, 2539301]);
      expect(result.numPages).toBe(517);
    });
  });

  describe("type coercion", () => {
    it("coerces string numbers to integers", () => {
      const result = normalizeBookMeta(
        JSON.stringify({ numPages: "350", publicationYear: "2023" }),
      );
      expect(result.numPages).toBe(350);
      expect(result.publicationYear).toBe(2023);
    });

    it("floors float page counts", () => {
      const result = normalizeBookMeta(JSON.stringify({ numPages: 350.9 }));
      expect(result.numPages).toBe(350);
    });
  });

  describe("validation", () => {
    it("rejects negative and zero numbers", () => {
      const result = normalizeBookMeta(JSON.stringify({ numPages: -5, publicationYear: 0 }));
      expect(result.numPages).toBeUndefined();
      expect(result.publicationYear).toBeUndefined();
    });

    it("rejects whitespace-only strings", () => {
      const result = normalizeBookMeta(
        JSON.stringify({ publisher: "   ", authorBio: " \n\t ", language: "  " }),
      );
      expect(result.publisher).toBeUndefined();
      expect(result.authorBio).toBeUndefined();
      expect(result.language).toBeUndefined();
    });

    it("trims strings", () => {
      const result = normalizeBookMeta(
        JSON.stringify({ publisher: "  Penguin  ", language: " English\n" }),
      );
      expect(result.publisher).toBe("Penguin");
      expect(result.language).toBe("English");
    });

    it("filters invalid entries from secondaryAuthors", () => {
      const result = normalizeBookMeta(
        JSON.stringify({
          secondaryAuthors: [
            { name: "Valid Author", role: "Editor" },
            { name: "", role: "Translator" },
            { role: "Illustrator" },
            "not an object",
            { name: "  Another Valid  " },
          ],
        }),
      );
      expect(result.secondaryAuthors).toEqual([
        { name: "Valid Author", role: "Editor" },
        { name: "Another Valid" },
      ]);
    });

    it("returns undefined for secondaryAuthors when all entries are invalid", () => {
      const result = normalizeBookMeta(
        JSON.stringify({
          secondaryAuthors: [{ name: "" }, { role: "only role" }],
        }),
      );
      expect(result.secondaryAuthors).toBeUndefined();
    });

    it("strips unknown fields", () => {
      const result = normalizeBookMeta(
        JSON.stringify({
          numPages: 100,
          isbn: "1234567890",
          isbn13: "9781234567890",
          somethingRandom: true,
        }),
      );
      expect(result.numPages).toBe(100);
      expect(result).not.toHaveProperty("isbn");
      expect(result).not.toHaveProperty("isbn13");
      expect(result).not.toHaveProperty("somethingRandom");
    });
  });
});
