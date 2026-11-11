import { personalLibraryQuery } from "../personalLibraryQuery";
import { personalBookFilename } from "../personalBookFilename";

describe("personal library filters", () => {
  it("sends the same filters on every page and includes them in the cache identity", () => {
    const filters = { shelfId: 7, q: "  Le Guin  ", sort: "author" as const };
    const first = personalLibraryQuery(filters);
    const next = personalLibraryQuery(filters, "offset/+24");
    expect(next.queryKey).toEqual(first.queryKey);
    expect(first.queryKey).toEqual(["personalLibrary", 7, "Le Guin", "author"]);
    const params = new URLSearchParams(next.url.split("?")[1]);
    expect(params.get("q")).toBe("Le Guin");
    expect(params.get("sort")).toBe("author");
    expect(params.get("shelfId")).toBe("7");
    expect(params.get("cursor")).toBe("offset/+24");
  });

  it("resets the cursor when search, shelf or sort changes", () => {
    const old = personalLibraryQuery({ q: "Dune", shelfId: 1 }, "24");
    for (const filters of [
      { q: "Earthsea", shelfId: 1 },
      { q: "Dune", shelfId: 2 },
      { q: "Dune", shelfId: 1, sort: "title" as const },
    ]) {
      const next = personalLibraryQuery(filters);
      expect(next.queryKey).not.toEqual(old.queryKey);
      expect(new URLSearchParams(next.url.split("?")[1]).has("cursor")).toBe(false);
    }
  });

  it("omits empty searches and bounds input to the server contract", () => {
    expect(personalLibraryQuery({ q: "  " }).url).not.toContain("q=");
    expect(personalLibraryQuery({ q: "x".repeat(300) }).queryKey[2]).toHaveLength(256);
  });
});

describe("ebook filenames", () => {
  it("keeps intrinsic Unicode filename and compound extension, not catalogue metadata", () => {
    expect(personalBookFilename({ filename: "Été - My copy.fb2.zip", format: "fb2" })).toBe(
      "Été - My copy.fb2.zip",
    );
  });
  it("strips path traversal and control characters, and supplies an extension for older servers", () => {
    expect(personalBookFilename({ filename: "../../book\n.epub", format: "epub" })).toBe(
      "book.epub",
    );
    expect(personalBookFilename({ format: "epub" })).toBe("book.epub");
  });
});
