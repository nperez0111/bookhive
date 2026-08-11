import { unzipSync, strFromU8 } from "fflate";
import type { BookCover, BookMetadata } from "./types";
import { attr, decodeXmlEntities, mimeForExt } from "./shared";
import { MAX_COVER_BYTES } from "./cover";

const IMAGE_NAME_RE = /\.(?:jpg|jpeg|png|gif|webp|svg)$/i;

/** One archive entry we know about but have deliberately not inflated yet. */
type ImageEntry = { name: string; originalSize: number };

/** Extract inner text of the first matching <dc:tag> (or <tag>) element. */
function firstDcValue(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return undefined;
  const text = decodeXmlEntities(m[1]!.trim());
  return text.length > 0 ? text : undefined;
}

/** Extract inner text of every matching <dc:tag> element. */
function allDcValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeXmlEntities(m[1]!.trim());
    if (text.length > 0) out.push(text);
  }
  return out;
}

/** Resolve an href relative to the directory of the .opf package document. */
function resolveHref(opfPath: string, href: string): string {
  const cleaned = href.replace(/^\.\//, "").split(/[?#]/)[0] ?? "";
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const parts = (dir ? dir + "/" + cleaned : cleaned).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/**
 * Parse EPUB metadata and cover from raw bytes. Never throws for a readable
 * ZIP; on any failure to find metadata it falls back to the provided
 * fallbackTitle with no authors/cover.
 */
export function parseEpub(bytes: Uint8Array, fallbackTitle: string): BookMetadata {
  const fallback: BookMetadata = { title: fallbackTitle, authors: "" };

  // Pass 1: inflate ONLY container.xml and the .opf, while noting the name and
  // size of every image without inflating any of them.
  //
  // This used to decompress every image in the archive in order to keep one.
  // Returning `false` from the filter still walks the central directory — the
  // entry's name and `originalSize` are available for free — so an index costs
  // nothing and the ~100 MB of pages in a large CBZ-style EPUB is never
  // materialised. See the second pass below for the one entry we do inflate.
  const images: ImageEntry[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        const n = file.name.toLowerCase();
        if (IMAGE_NAME_RE.test(n)) {
          images.push({ name: file.name, originalSize: file.originalSize });
          return false;
        }
        return n === "meta-inf/container.xml" || n.endsWith(".opf");
      },
    });
  } catch {
    return fallback;
  }

  // Build a case-insensitive lookup of file name -> bytes.
  const byLowerName = new Map<string, { name: string; data: Uint8Array }>();
  for (const [name, data] of Object.entries(files)) {
    byLowerName.set(name.toLowerCase(), { name, data });
  }

  // 1. Find the .opf path via container.xml (fall back to first .opf).
  let opfPath: string | undefined;
  const container = byLowerName.get("meta-inf/container.xml");
  if (container) {
    const containerXml = strFromU8(container.data);
    const rootfile = containerXml.match(/<rootfile\b[^>]*>/i)?.[0];
    if (rootfile) opfPath = attr(rootfile, "full-path");
  }
  if (!opfPath) {
    for (const { name } of byLowerName.values()) {
      if (name.toLowerCase().endsWith(".opf")) {
        opfPath = name;
        break;
      }
    }
  }
  if (!opfPath) return fallback;

  const opfEntry = byLowerName.get(opfPath.toLowerCase());
  if (!opfEntry) return fallback;
  const opf = strFromU8(opfEntry.data);

  // 2. Extract Dublin Core metadata.
  const title = firstDcValue(opf, "title") ?? fallbackTitle;
  const authors = allDcValues(opf, "creator").join(", ");
  const language = firstDcValue(opf, "language");
  const identifier = firstDcValue(opf, "identifier");

  // 3. Locate the cover image, then inflate exactly that one entry.
  const imagesByLowerName = new Map<string, ImageEntry>();
  for (const image of images) imagesByLowerName.set(image.name.toLowerCase(), image);
  const cover = inflateCover(bytes, findCoverEntry(opf, opfPath, imagesByLowerName));

  return { title, authors, language, identifier, cover };
}

/**
 * Pass 2: decompress the single chosen image. Guarded on `originalSize` so a
 * book advertising a 200 MB "cover" can't inflate unbounded — nothing we do
 * with a cover needs more than MAX_COVER_BYTES.
 */
function inflateCover(bytes: Uint8Array, entry: ImageEntry | undefined): BookCover | undefined {
  if (!entry || entry.originalSize > MAX_COVER_BYTES) return undefined;
  let data: Uint8Array | undefined;
  try {
    data = unzipSync(bytes, { filter: (f) => f.name === entry.name })[entry.name];
  } catch {
    return undefined;
  }
  if (!data || data.length === 0) return undefined;
  const ext = (entry.name.split(".").pop() || "").toLowerCase();
  const normExt = ext === "jpeg" ? "jpg" : ext;
  return { bytes: data, mime: mimeForExt(normExt), ext: normExt };
}

function findCoverEntry(
  opf: string,
  opfPath: string,
  byLowerName: Map<string, ImageEntry>,
): ImageEntry | undefined {
  const itemTags = opf.match(/<item\b[^>]*>/gi) ?? [];

  const findByHref = (href?: string): ImageEntry | undefined => {
    if (!href) return undefined;
    return byLowerName.get(resolveHref(opfPath, href).toLowerCase());
  };

  // EPUB3: item with properties="cover-image".
  for (const tag of itemTags) {
    const props = attr(tag, "properties");
    if (props && /\bcover-image\b/.test(props)) {
      const cover = findByHref(attr(tag, "href"));
      if (cover) return cover;
    }
  }

  // EPUB2: <meta name="cover" content="ID"> -> item with that id.
  const metaCover = opf.match(/<meta\b[^>]*\bname\s*=\s*"cover"[^>]*>/i)?.[0];
  const coverId = metaCover ? attr(metaCover, "content") : undefined;
  if (coverId) {
    for (const tag of itemTags) {
      if (attr(tag, "id") === coverId) {
        const cover = findByHref(attr(tag, "href"));
        if (cover) return cover;
      }
    }
  }

  // Fallback: any manifest image item whose id/href mentions "cover".
  for (const tag of itemTags) {
    const id = attr(tag, "id") || "";
    const href = attr(tag, "href") || "";
    const mediaType = attr(tag, "media-type") || "";
    if (mediaType.startsWith("image/") && (/cover/i.test(id) || /cover/i.test(href))) {
      const cover = findByHref(href);
      if (cover) return cover;
    }
  }

  return undefined;
}
