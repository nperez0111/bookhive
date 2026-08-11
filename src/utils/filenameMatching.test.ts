import { describe, it, expect } from "bun:test";

import {
  authorsMatch,
  filenameBasename,
  filenameBookCandidates,
  filenameKey,
  koreaderFilenameHash,
  normalizeAuthor,
  normalizeTitle,
  titlesEquivalent,
} from "./filenameMatching";

describe("koreaderFilenameHash", () => {
  it("is md5 of the basename, matching KOSync's FILENAME checksum method", () => {
    // KOReader: `md5(file_name)` where file_name is util.splitFilePathName's
    // second return — the basename, extension included. This is the id such a
    // client sends as `document`, so the value has to be byte-exact.
    const expected = new Bun.CryptoHasher("md5").update("Dune.epub", "utf8").digest("hex");
    expect(koreaderFilenameHash("Dune.epub")).toBe(expected);
    expect(koreaderFilenameHash("/mnt/onboard/books/Dune.epub")).toBe(expected);
    expect(koreaderFilenameHash("D:\\books\\Dune.epub")).toBe(expected);
  });

  it("returns null rather than hashing nothing", () => {
    expect(koreaderFilenameHash(null)).toBeNull();
    expect(koreaderFilenameHash("")).toBeNull();
    expect(koreaderFilenameHash("   ")).toBeNull();
  });
});

describe("filenameBasename", () => {
  it("handles both separators", () => {
    expect(filenameBasename("/a/b/c.epub")).toBe("c.epub");
    expect(filenameBasename("a\\b\\c.epub")).toBe("c.epub");
    expect(filenameBasename("c.epub")).toBe("c.epub");
  });
});

describe("filenameKey", () => {
  it("survives the format conversion that broke the content hash", () => {
    // The whole reason users switch off binary checksums: calibre re-encodes
    // the file, so the bytes (and the extension) differ but the book does not.
    expect(filenameKey("Dune - Frank Herbert.epub")).toBe(filenameKey("dune_-_frank_herbert.azw3"));
  });

  it("ignores release noise and copy markers", () => {
    expect(filenameKey("Dune (z-lib.org) [Retail].epub")).toBe("dune");
    expect(filenameKey("Dune (1).epub")).toBe("dune");
  });

  it("keeps a dot-number that is part of the title", () => {
    // A generic `\.\w+$` strip would turn this into "foundation vol".
    expect(filenameKey("Foundation Vol.2.epub")).toBe("foundation vol 2");
  });

  it("folds diacritics so the same book from two sources agrees", () => {
    expect(filenameKey("Les Misérables.epub")).toBe(filenameKey("Les Miserables.mobi"));
  });

  it("returns null when nothing indexable survives", () => {
    // Must not be "", or every metadata-less document would match every other.
    expect(filenameKey(null)).toBeNull();
    expect(filenameKey("---.epub")).toBeNull();
  });
});

describe("filenameBookCandidates", () => {
  const pairs = (filename: string) =>
    filenameBookCandidates(filename).map((c) => [c.title, c.authors]);

  it("emits both orderings of an A - B split", () => {
    // Nothing in the string says which convention this is, and the caller
    // resolves the ambiguity against the catalogue.
    expect(pairs("Ursula K. Le Guin - The Dispossessed.epub")).toContainEqual([
      "The Dispossessed",
      "Ursula K. Le Guin",
    ]);
    expect(pairs("The Dispossessed - Ursula K. Le Guin.epub")).toContainEqual([
      "The Dispossessed",
      "Ursula K. Le Guin",
    ]);
  });

  it("reads a trailing parenthetical as the author", () => {
    expect(pairs("The Dispossessed (Ursula K. Le Guin).epub")).toContainEqual([
      "The Dispossessed",
      "Ursula K. Le Guin",
    ]);
  });

  it("drops a leading series index", () => {
    expect(pairs("01 - The Fellowship of the Ring - J.R.R. Tolkien.epub")).toContainEqual([
      "The Fellowship of the Ring",
      "J.R.R. Tolkien",
    ]);
  });

  it("still offers a title for a bare filename", () => {
    expect(pairs("The Dispossessed.epub")).toEqual([["The Dispossessed", null]]);
  });

  it("reads underscores as spaces", () => {
    expect(pairs("Frank_Herbert_-_Dune.epub")).toContainEqual(["Dune", "Frank Herbert"]);
  });

  it("declines a two-character title, which is an index or a stray token", () => {
    expect(filenameBookCandidates("a.epub")).toEqual([]);
    expect(filenameBookCandidates("")).toEqual([]);
    expect(filenameBookCandidates(null)).toEqual([]);
  });
});

describe("normalizeTitle", () => {
  it("drops a trailing series or edition tail", () => {
    expect(normalizeTitle("Dune (Dune Chronicles #1)")).toBe("dune");
    expect(normalizeTitle("Emma [Illustrated]")).toBe("emma");
  });

  it("folds case, punctuation and diacritics", () => {
    expect(normalizeTitle("The Hitchhiker's Guide")).toBe("the hitchhiker s guide");
    expect(normalizeTitle("Les Misérables")).toBe("les miserables");
  });
});

describe("titlesEquivalent", () => {
  it("ignores punctuation, stop words and word order", () => {
    expect(
      titlesEquivalent("Hitchhikers Guide to the Galaxy", "The Hitchhiker's Guide to the Galaxy"),
    ).toBe(true);
    expect(titlesEquivalent("Hobbit", "The Hobbit")).toBe(true);
  });

  it("rejects a title that merely contains the other", () => {
    // The reason the word gate runs both ways: this is a real, different book
    // by the same author, so no downstream check would catch it.
    expect(titlesEquivalent("Dune", "Dune Messiah")).toBe(false);
    expect(titlesEquivalent("Children of Time", "Children of Ruin")).toBe(false);
  });

  it("does not call two unmatched non-Latin titles equivalent", () => {
    // Both sides normalize to no ASCII content words; that is absence of
    // evidence, not agreement.
    expect(titlesEquivalent("戦争と平和", "白鯨")).toBe(false);
    expect(titlesEquivalent("戦争と平和", "戦争と平和")).toBe(true);
  });
});

describe("normalizeAuthor", () => {
  it("un-inverts a Last, First name", () => {
    expect(normalizeAuthor("Le Guin, Ursula K.")).toBe("ursula k le guin");
  });
});

describe("authorsMatch", () => {
  it("matches across punctuation and inversion", () => {
    expect(authorsMatch("J.R.R. Tolkien", "J R R Tolkien")).toBe(true);
    expect(authorsMatch("Tolkien, J.R.R.", "J.R.R. Tolkien")).toBe(true);
  });

  it("matches initials against the spelled-out name", () => {
    expect(authorsMatch("J.R.R. Tolkien", "John Ronald Reuel Tolkien")).toBe(true);
  });

  it("does not accept a shared surname alone", () => {
    // The reason the first-initial check exists: a surname on its own would
    // link a book to the wrong member of a writing family.
    expect(authorsMatch("Jane Tolkien", "John Tolkien")).toBe(false);
    expect(authorsMatch("Tolkien", "John Tolkien")).toBe(false);
  });

  it("rejects unrelated names", () => {
    expect(authorsMatch("Frank Herbert", "Ursula K. Le Guin")).toBe(false);
    expect(authorsMatch("", "Frank Herbert")).toBe(false);
  });
});
