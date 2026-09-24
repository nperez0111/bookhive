import { describe, it, expect } from "bun:test";

import { canonicalDownloadFilename, withExtension } from "./downloadFilename";

describe("canonicalDownloadFilename", () => {
  it("keeps a name that is already clean", () => {
    expect(canonicalDownloadFilename("Dune.epub", "epub")).toBe("Dune.epub");
  });

  it("produces a segment that needs no percent-encoding", () => {
    const name = canonicalDownloadFilename("The Handmaid's Tale (Anniversary Ed.).epub", "epub");
    expect(name).toBe("The_Handmaid_s_Tale_Anniversary_Ed.epub");
    expect(encodeURIComponent(name)).toBe(name);
  });

  it("folds Latin diacritics to their base letters rather than dropping the word", () => {
    expect(canonicalDownloadFilename("Beloved Amrán — Café.epub", "epub")).toBe(
      "Beloved_Amran_Cafe.epub",
    );
  });

  it("falls back to a generic stem when nothing survives", () => {
    // Cyrillic and CJK have no ASCII form, so the alternative is a row of
    // underscores. `filename*` still carries the real name.
    expect(canonicalDownloadFilename("Война и мир.epub", "epub")).toBe("book.epub");
    expect(canonicalDownloadFilename("", "epub")).toBe("book.epub");
    expect(canonicalDownloadFilename(null, null)).toBe("book.epub");
  });

  it("uses the stored format for the extension, not the uploaded name's", () => {
    // The format came from magic bytes at upload time and decides the
    // Content-Type; the original extension is only what the user happened to
    // call the file.
    expect(canonicalDownloadFilename("Comic.zip", "cbz")).toBe("Comic.cbz");
    expect(canonicalDownloadFilename("Book.azw3", "mobi")).toBe("Book.mobi");
  });

  it("handles the .fb2.zip double extension without doubling it up", () => {
    expect(canonicalDownloadFilename("Solaris.fb2.zip", "fb2")).toBe("Solaris.fb2");
  });

  it("does not mistake a title's last word for an extension", () => {
    expect(canonicalDownloadFilename("Dune Messiah", "epub")).toBe("Dune_Messiah.epub");
    expect(canonicalDownloadFilename("Discworld Vol. 2", "epub")).toBe("Discworld_Vol._2.epub");
  });

  it("collapses separator runs and trims the edges", () => {
    expect(canonicalDownloadFilename("  ...A   Book!!!  .epub", "epub")).toBe("A_Book.epub");
  });

  it("caps the stem so the URL and header stay a sane length", () => {
    const long = `${"a".repeat(200)}.epub`;
    const name = canonicalDownloadFilename(long, "epub");
    expect(name.length).toBeLessThanOrEqual(85);
    expect(name.endsWith(".epub")).toBe(true);
  });

  it("cannot emit a path separator", () => {
    // The value lands in a URL path segment, so a slash would change the route
    // it addresses.
    const name = canonicalDownloadFilename("../../etc/passwd.epub", "epub");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).toBe("etc_passwd.epub");
  });

  it("sanitizes a hostile format value too", () => {
    expect(canonicalDownloadFilename("Book.epub", "../x")).toBe("Book.x");
  });
});

describe("withExtension", () => {
  // Feeds `Content-Disposition`'s `filename*`, whose whole purpose is the real
  // name — so unlike the canonical form it must not transliterate anything.
  it("keeps a non-ASCII stem intact", () => {
    expect(withExtension("Война и мир.mobi", "epub")).toBe("Война и мир.epub");
    expect(withExtension("Café Amrán.azw3", "epub")).toBe("Café Amrán.epub");
  });

  it("swaps the extension rather than appending one", () => {
    expect(withExtension("Dune.mobi", "epub")).toBe("Dune.epub");
    expect(withExtension("Solaris.fb2.zip", "epub")).toBe("Solaris.epub");
  });

  it("adds an extension when there is none", () => {
    expect(withExtension("Dune Messiah", "epub")).toBe("Dune Messiah.epub");
  });

  it("does not mistake a title's last word for an extension", () => {
    expect(withExtension("Discworld Vol. 2", "epub")).toBe("Discworld Vol. 2.epub");
  });

  it("falls back rather than emitting a bare extension", () => {
    expect(withExtension("", "epub")).toBe("book.epub");
    expect(withExtension(null, null)).toBe("book.epub");
  });

  it("sanitizes a hostile extension", () => {
    expect(withExtension("Book.mobi", "../x")).toBe("Book.x");
  });
});
