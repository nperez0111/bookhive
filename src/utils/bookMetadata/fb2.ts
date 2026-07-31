// Synchronous, in-memory FB2 metadata + cover extractor.
// FB2 is a single XML file; it may also be delivered zipped as .fb2.zip.

import { unzipSync, strFromU8 } from "fflate";
import type { BookCover, BookMetadata } from "./types";
import { attr, base64ToBytes, decodeXmlEntities, looksLikeZip, MIME_EXT } from "./shared";

/** Inner text of the first matching (namespace-agnostic) element. */
function firstTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return undefined;
  const text = decodeXmlEntities(m[1]!.replace(/<[^>]+>/g, "").trim());
  return text.length > 0 ? text : undefined;
}

/** All matching element blocks (raw inner XML, not stripped). */
function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]!);
  return out;
}

function extractXml(bytes: Uint8Array): string | undefined {
  // .fb2.zip: a single .fb2 XML inside a ZIP.
  if (looksLikeZip(bytes)) {
    try {
      const files = unzipSync(bytes, {
        filter: (f) => f.name.toLowerCase().endsWith(".fb2"),
      });
      const first = Object.values(files)[0];
      return first ? strFromU8(first) : undefined;
    } catch {
      return undefined;
    }
  }
  return strFromU8(bytes);
}

/**
 * Parse FB2 metadata and cover from raw bytes (.fb2 or .fb2.zip). Never throws;
 * on any failure falls back to the provided fallbackTitle.
 */
export function parseFb2(bytes: Uint8Array, fallbackTitle: string): BookMetadata {
  const fallback: BookMetadata = { title: fallbackTitle, authors: "" };
  try {
    const xml = extractXml(bytes);
    if (!xml || !/<FictionBook\b/i.test(xml)) return fallback;

    // Metadata lives in <description><title-info>.
    const titleInfo = firstBlock(xml, "title-info") ?? xml;

    const title = firstTag(titleInfo, "book-title") ?? fallbackTitle;
    const language = firstTag(titleInfo, "lang");

    const authors: string[] = [];
    for (const authorBlock of allBlocks(titleInfo, "author")) {
      const parts = [
        firstTag(authorBlock, "first-name"),
        firstTag(authorBlock, "middle-name"),
        firstTag(authorBlock, "last-name"),
      ].filter((p): p is string => !!p);
      const nick = firstTag(authorBlock, "nickname");
      const name = parts.join(" ").trim() || nick;
      if (name) authors.push(name);
    }

    const docInfo = firstBlock(xml, "document-info");
    const identifier = docInfo ? firstTag(docInfo, "id") : undefined;

    const cover = findFb2Cover(xml, titleInfo);

    return {
      title,
      authors: authors.join(", "),
      language,
      identifier,
      cover,
    };
  } catch {
    return fallback;
  }
}

/** First matching element block including only its inner XML. */
function firstBlock(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  return xml.match(re)?.[1];
}

function findFb2Cover(xml: string, titleInfo: string): BookCover | undefined {
  // <coverpage><image l:href="#id"/></coverpage>
  const coverpage = firstBlock(titleInfo, "coverpage");
  if (!coverpage) return undefined;
  const imageTag = coverpage.match(/<image\b[^>]*>/i)?.[0];
  if (!imageTag) return undefined;
  const href = attr(imageTag, "l:href") || attr(imageTag, "xlink:href") || attr(imageTag, "href");
  if (!href) return undefined;
  const id = href.replace(/^#/, "");
  if (!id) return undefined;

  // <binary id="id" content-type="image/jpeg">BASE64</binary>
  const re = new RegExp(
    `<binary\\b[^>]*\\bid\\s*=\\s*"${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)</binary>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return undefined;
  const openTag = m[0].match(/<binary\b[^>]*>/i)?.[0] || "";
  const contentType = attr(openTag, "content-type") || "image/jpeg";
  const data = base64ToBytes(m[1]!);
  if (data.byteLength === 0) return undefined;
  const ext = MIME_EXT[contentType] || "jpg";
  return { bytes: data, mime: contentType, ext };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
