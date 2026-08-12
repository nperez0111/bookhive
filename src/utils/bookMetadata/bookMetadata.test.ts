import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { imageMeta } from "image-meta";
import {
  koreaderPartialMD5,
  parseBook,
  detectFormat,
  isUsableCover,
  prepareCover,
  MIN_COVER_DIMENSION,
} from ".";
import { makeSvgCover, PNG_32 } from "./testFixtures";

// 1x1 red PNG (a degenerate placeholder cover).
const RED_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

// Minimal JPEG magic bytes (enough for magic-byte sniffing).
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

// -----------------------------------------------------------------------------
// koreaderPartialMD5 — this hash is how books line up with KOReader progress,
// so a couple of obvious invariants are worth guarding.
// -----------------------------------------------------------------------------

describe("koreaderPartialMD5", () => {
  test("hashes empty input to the MD5 of nothing", () => {
    expect(koreaderPartialMD5(new Uint8Array(0))).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  test("returns a stable 32-char hex digest", () => {
    const bytes = strToU8("some book bytes");
    const hash = koreaderPartialMD5(bytes);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(koreaderPartialMD5(bytes)).toBe(hash);
  });
});

// -----------------------------------------------------------------------------
// parseBook — one happy path per supported format via the public dispatcher.
// -----------------------------------------------------------------------------

function makeEpub(): Uint8Array {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Great Test Book</dc:title>
    <dc:creator>Jane Doe</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/ch1.xhtml": strToU8("<html><body>hi</body></html>"),
    "OEBPS/cover.png": RED_PNG,
  });
}

const FB2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>A Fictional Story</book-title>
      <lang>ru</lang>
      <author><first-name>Leo</first-name><last-name>Tolstoy</last-name></author>
      <coverpage><image l:href="#cover.jpg"/></coverpage>
    </title-info>
  </description>
  <binary id="cover.jpg" content-type="image/jpeg">${btoa(String.fromCharCode(...JPEG))}</binary>
</FictionBook>`;

describe("parseBook", () => {
  test("extracts EPUB metadata and cover", () => {
    const meta = parseBook(makeEpub(), "book.epub");
    expect(meta.title).toBe("The Great Test Book");
    expect(meta.authors).toBe("Jane Doe");
    expect(meta.language).toBe("en");
    expect(meta.cover?.mime).toBe("image/png");
  });

  test("extracts FB2 metadata and cover", () => {
    const meta = parseBook(strToU8(FB2_XML), "story.fb2");
    expect(meta.title).toBe("A Fictional Story");
    expect(meta.authors).toBe("Leo Tolstoy");
    expect(meta.cover?.mime).toBe("image/jpeg");
  });

  test("uses the first image as the cover for a CBZ", () => {
    const cbz = zipSync({ "002.png": RED_PNG, "001.jpg": JPEG });
    const meta = parseBook(cbz, "My Comic.cbz");
    // Natural sort => 001.jpg is first.
    expect(meta.title).toBe("My Comic");
    expect(meta.cover?.mime).toBe("image/jpeg");
  });

  test("falls back to the filename when the file can't be parsed", () => {
    const meta = parseBook(strToU8("not a real book"), "Some Book.epub");
    expect(meta.title).toBe("Some Book");
    expect(meta.authors).toBe("");
    expect(meta.cover).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// detectFormat — the obvious "accept the real thing, reject the fake" cases.
// -----------------------------------------------------------------------------

describe("detectFormat", () => {
  test("recognises a real EPUB", () => {
    const info = detectFormat(makeEpub(), "book.epub");
    expect(info.format).toBe("epub");
    expect(info.mime).toBe("application/epub+zip");
  });

  test("rejects a file that is merely named .epub", () => {
    expect(detectFormat(strToU8("hello"), "not.epub").format).toBe("unknown");
  });
});

// -----------------------------------------------------------------------------
// isUsableCover — gates whether an extracted cover is stored or replaced by the
// placeholder.
// -----------------------------------------------------------------------------

describe("isUsableCover", () => {
  test("accepts a real, adequately-sized image", async () => {
    const bigPng = await new Bun.Image(RED_PNG).resize(32, 48).png().bytes();
    expect(isUsableCover(bigPng)).toBe(true);
  });

  test("rejects a 1x1 placeholder and empty input", () => {
    expect(isUsableCover(RED_PNG)).toBe(false);
    expect(isUsableCover(new Uint8Array())).toBe(false);
    expect(isUsableCover(undefined)).toBe(false);
  });

  test("rejects bytes that are not an image at all", () => {
    expect(isUsableCover(strToU8("definitely not an image"))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// prepareCover — the gate between "the parser found something" and "we store a
// cover". Rasterizes SVG, because an SVG cover is a composition, not a wrapper.
// -----------------------------------------------------------------------------

describe("prepareCover", () => {
  test("passes a raster cover through untouched", async () => {
    const out = await prepareCover({ bytes: PNG_32, mime: "image/png", ext: "png" });
    expect(out?.ext).toBe("png");
    expect(out?.bytes).toBe(PNG_32);
  });

  test("rasterizes an SVG cover to a JPEG", async () => {
    const out = await prepareCover({ bytes: makeSvgCover(), mime: "image/svg+xml", ext: "svg" });
    expect(out).not.toBeNull();
    // JPEG, not SVG: OPDS clients and e-readers can't be relied on to render
    // vector covers, and nothing should ever write an SVG to the library.
    expect(out!.ext).toBe("jpg");
    expect(out!.mime).toBe("image/jpeg");
    const meta = imageMeta(out!.bytes);
    expect(meta.type).toBe("jpg");
    expect(meta.width).toBeGreaterThanOrEqual(MIN_COVER_DIMENSION);
  });

  test("renders BOTH svg layers — the artwork and the lettering over it", async () => {
    // The whole reason this rasterizes instead of unwrapping the embedded
    // <image>. Rendering is deterministic, so comparing the full cover against
    // each single-layer version pins down the two real failure modes:
    //   - equal to the paths-only render  => the artwork was dropped
    //     (what @takumi-rs does: it ignores the embedded <image> entirely)
    //   - equal to the image-only render  => the lettering was dropped
    //     (what pulling the base64 raster back out of the SVG does)
    const render = async (layers: "both" | "image" | "paths") =>
      (await prepareCover({
        bytes: makeSvgCover({ layers }),
        mime: "image/svg+xml",
        ext: "svg",
      }))!.bytes;

    const [both, imageOnly, pathsOnly] = await Promise.all([
      render("both"),
      render("image"),
      render("paths"),
    ]);

    expect(Buffer.compare(both, pathsOnly)).not.toBe(0);
    expect(Buffer.compare(both, imageOnly)).not.toBe(0);
    // Sanity: the two degenerate renders differ from each other too, so the
    // assertions above can't both pass on a renderer that emits a constant.
    expect(Buffer.compare(imageOnly, pathsOnly)).not.toBe(0);
  });

  test("returns null for an unrenderable SVG rather than throwing", async () => {
    const out = await prepareCover({
      bytes: strToU8("<svg><this is not valid"),
      mime: "image/svg+xml",
      ext: "svg",
    });
    expect(out).toBeNull();
  });

  test("returns null for a cover below the minimum dimension", async () => {
    expect(await prepareCover({ bytes: RED_PNG, mime: "image/png", ext: "png" })).toBeNull();
    expect(await prepareCover(undefined)).toBeNull();
  });
});
