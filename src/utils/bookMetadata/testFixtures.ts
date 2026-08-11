/**
 * Synthetic ebook fixtures for tests.
 *
 * Built with fflate's `zipSync` rather than checked in as binaries so the
 * contents are readable in the diff and a test can vary one thing (a 1x1 cover,
 * an oversized page) without a new blob appearing in the repo.
 */

import { zipSync, strToU8 } from "fflate";

/**
 * A real 32x32 PNG. Has to decode for `isUsableCover` — which reads the header
 * with Bun's image pipeline — so it can't be arbitrary bytes.
 */
export const PNG_32 = (() => {
  // 32x32, 8-bit RGBA, single IDAT of zlib-stored zeroes.
  const raw = new Uint8Array(32 * (32 * 4 + 1)); // filter byte per scanline
  const idat = Bun.deflateSync(raw);
  const chunks: Uint8Array[] = [];
  const be32 = (n: number) =>
    new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const typeBytes = new TextEncoder().encode(type);
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes);
    body.set(data, typeBytes.length);
    chunks.push(be32(data.length), body, be32(crc(body)));
  };
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(32), 0);
  ihdr.set(be32(32), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const total = signature.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(signature);
  let offset = signature.length;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
})();

/** A 1x1 PNG — decodes fine, but below MIN_COVER_DIMENSION so it must be rejected. */
export const PNG_1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export type EpubFixtureOptions = {
  title?: string;
  authors?: string[];
  language?: string;
  /** Cover image bytes; omit for a book with no cover at all. */
  cover?: Uint8Array | undefined;
  /** Extra padding, to push the file past a size threshold. */
  padBytes?: number;
};

/** A minimal but genuinely valid EPUB: mimetype, container.xml, OPF, cover. */
export function makeEpub(options: EpubFixtureOptions = {}): Uint8Array {
  const {
    title = "The Test Book",
    authors = ["A Test Author"],
    language = "en",
    cover = PNG_32,
    padBytes = 0,
  } = options;

  const manifest = cover
    ? `<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>`
    : "";
  const opf =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${title}</dc:title>` +
    authors.map((a) => `<dc:creator>${a}</dc:creator>`).join("") +
    `<dc:language>${language}</dc:language>` +
    `</metadata><manifest>${manifest}</manifest></package>`;

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
        `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(opf),
  };
  if (cover) files["OEBPS/images/cover.png"] = cover;
  if (padBytes > 0) {
    // Random so it doesn't deflate to nothing — the point of padding is size.
    const pad = new Uint8Array(padBytes);
    crypto.getRandomValues(pad);
    files["OEBPS/pad.bin"] = pad;
  }
  return zipSync(files);
}

/**
 * A CBZ whose pages sort such that page 1 is small and page 2 is large — so a
 * test can assert the cover extractor took the first page without inflating
 * the rest.
 */
export function makeCbz(pageCount = 20, bigPageBytes = 200_000): Uint8Array {
  const files: Record<string, Uint8Array> = { "001.png": PNG_32 };
  for (let i = 2; i <= pageCount; i++) {
    const big = new Uint8Array(bigPageBytes);
    big.set(PNG_32);
    files[`${String(i).padStart(3, "0")}.png`] = big;
  }
  return zipSync(files);
}

/** The smallest thing `detectFormat` accepts with no zip container. */
export function makeFb2(title = "FB2 Book", author = "FB2 Author"): Uint8Array {
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">` +
      `<description><title-info>` +
      `<book-title>${title}</book-title>` +
      `<author><first-name>${author.split(" ")[0]}</first-name><last-name>${author.split(" ").slice(1).join(" ")}</last-name></author>` +
      `</title-info></description><body/></FictionBook>`,
  );
}
