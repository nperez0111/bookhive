import { unzipSync, strFromU8 } from "fflate";
import type { BookCover, BookMetadata } from "./types";
import { attr, decodeXmlEntities, mimeForExt } from "./shared";

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

  let files: Record<string, Uint8Array>;
  try {
    // Only decompress the small files we actually need plus any image (cover).
    files = unzipSync(bytes, {
      filter(file) {
        const n = file.name.toLowerCase();
        return (
          n === "meta-inf/container.xml" ||
          n.endsWith(".opf") ||
          n.endsWith(".jpg") ||
          n.endsWith(".jpeg") ||
          n.endsWith(".png") ||
          n.endsWith(".gif") ||
          n.endsWith(".webp") ||
          n.endsWith(".svg")
        );
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

  // 3. Locate the cover image.
  const cover = findCover(opf, opfPath, byLowerName);

  return { title, authors, language, identifier, cover };
}

function findCover(
  opf: string,
  opfPath: string,
  byLowerName: Map<string, { name: string; data: Uint8Array }>,
): BookCover | undefined {
  const itemTags = opf.match(/<item\b[^>]*>/gi) ?? [];

  const findByHref = (href?: string): BookCover | undefined => {
    if (!href) return undefined;
    const resolved = resolveHref(opfPath, href).toLowerCase();
    const entry = byLowerName.get(resolved);
    if (!entry) return undefined;
    const ext = (entry.name.split(".").pop() || "").toLowerCase();
    const normExt = ext === "jpeg" ? "jpg" : ext;
    return { bytes: entry.data, mime: mimeForExt(normExt), ext: normExt };
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
