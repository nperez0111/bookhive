// Synchronous, in-memory MOBI / KF8 (AZW3) metadata + cover extractor.
// Ported (metadata/cover paths only) from foliate-js/mobi.js (MIT).
// All text/rendering/decompression code is intentionally omitted.

import type { BookCover, BookMetadata } from "./types";
import { imageMimeFromMagic, MIME_EXT, unescapeHTML } from "./shared";

const utf8 = new TextDecoder("utf-8");

/** True if the bytes look like a Palm-Database MOBI file ("BOOKMOBI" @ 60). */
export function isMOBI(bytes: Uint8Array): boolean {
  if (bytes.length < 68) return false;
  return getString(bytes.subarray(60, 68)) === "BOOKMOBI";
}

function getString(buf: Uint8Array): string {
  return utf8.decode(buf);
}

function getUint(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength >= 4) return view.getUint32(0);
  if (buf.byteLength >= 2) return view.getUint16(0);
  return view.getUint8(0);
}

type FieldDef = [start: number, len: number, type?: "string" | "uint"];

function getStruct(def: Record<string, FieldDef>, buf: Uint8Array) {
  const out: Record<string, string | number> = {};
  for (const [key, [start, len, type]] of Object.entries(def)) {
    const slice = buf.subarray(start, start + len);
    out[key] = type === "string" ? getString(slice) : getUint(slice);
  }
  return out;
}

const MOBI_ENCODING: Record<number, string> = {
  1252: "windows-1252",
  65001: "utf-8",
};

const EXTH_RECORD_TYPE: Record<number, [string, ("string" | "uint")?, boolean?]> = {
  100: ["creator", "string", true],
  101: ["publisher"],
  103: ["description"],
  104: ["isbn"],
  106: ["date"],
  108: ["contributor", "string", true],
  121: ["boundary", "uint"],
  129: ["coverURI"],
  201: ["coverOffset", "uint"],
  202: ["thumbnailOffset", "uint"],
  503: ["title"],
  524: ["language", "string", true],
};

const MOBI_LANG: Record<number, (string | null)[]> = {
  1: ["ar", "ar-SA"],
  2: ["bg"],
  3: ["ca"],
  4: ["zh", "zh-TW", "zh-CN", "zh-HK", "zh-SG"],
  5: ["cs"],
  6: ["da"],
  7: ["de", "de-DE", "de-CH", "de-AT", "de-LU", "de-LI"],
  8: ["el"],
  9: [
    "en",
    "en-US",
    "en-GB",
    "en-AU",
    "en-CA",
    "en-NZ",
    "en-IE",
    "en-ZA",
    "en-JM",
    null,
    "en-BZ",
    "en-TT",
    "en-ZW",
    "en-PH",
  ],
  10: ["es", "es-ES", "es-MX"],
  11: ["fi"],
  12: ["fr", "fr-FR", "fr-BE", "fr-CA", "fr-CH", "fr-LU", "fr-MC"],
  13: ["he"],
  14: ["hu"],
  15: ["is"],
  16: ["it", "it-IT", "it-CH"],
  17: ["ja"],
  18: ["ko"],
  19: ["nl", "nl-NL", "nl-BE"],
  20: ["no", "nb", "nn"],
  21: ["pl"],
  22: ["pt", "pt-BR", "pt-PT"],
  24: ["ro"],
  25: ["ru"],
  27: ["sk"],
  29: ["sv", "sv-SE", "sv-FI"],
  30: ["th"],
  31: ["tr"],
  33: ["id"],
  34: ["uk"],
};

const PDB_HEADER: Record<string, FieldDef> = {
  name: [0, 32, "string"],
  type: [60, 4, "string"],
  creator: [64, 4, "string"],
  numRecords: [76, 2, "uint"],
};

const MOBI_HEADER: Record<string, FieldDef> = {
  magic: [16, 4, "string"],
  length: [20, 4, "uint"],
  type: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  uid: [32, 4, "uint"],
  version: [36, 4, "uint"],
  titleOffset: [84, 4, "uint"],
  titleLength: [88, 4, "uint"],
  localeRegion: [94, 1, "uint"],
  localeLanguage: [95, 1, "uint"],
  resourceStart: [108, 4, "uint"],
  exthFlag: [128, 4, "uint"],
};

interface PdbRecordRange {
  offset: number;
  end: number;
}

/** Parse the PDB record offset table. */
function getRecords(bytes: Uint8Array): PdbRecordRange[] {
  const { numRecords } = getStruct(PDB_HEADER, bytes) as {
    numRecords: number;
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    offsets.push(view.getUint32(78 + i * 8));
  }
  const records: PdbRecordRange[] = [];
  for (let i = 0; i < offsets.length; i++) {
    records.push({
      offset: offsets[i]!,
      end: i + 1 < offsets.length ? offsets[i + 1]! : bytes.length,
    });
  }
  return records;
}

function getEXTH(buf: Uint8Array, encoding: string) {
  const result: Record<string, unknown> = {};
  const decoder = safeDecoder(encoding);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(8);
  let offset = 12;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > buf.byteLength) break;
    const type = view.getUint32(offset);
    const len = view.getUint32(offset + 4);
    if (len < 8 || offset + len > buf.byteLength) break;
    const data = buf.subarray(offset + 8, offset + len);
    const entry = EXTH_RECORD_TYPE[type];
    if (entry) {
      const [name, kind = "string", many = false] = entry;
      const value = kind === "uint" ? getUint(data) : decoder.decode(data);
      if (many) {
        (result[name] as unknown[]) = ((result[name] as unknown[]) || []).concat(value);
      } else {
        result[name] = value;
      }
    }
    offset += len;
  }
  return result;
}

function safeDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    return utf8;
  }
}

/**
 * Parse MOBI/AZW3 metadata and cover from raw bytes. Never throws; on any
 * failure falls back to the provided fallbackTitle with no authors/cover.
 */
export function parseMobi(bytes: Uint8Array, fallbackTitle: string): BookMetadata {
  const fallback: BookMetadata = { title: fallbackTitle, authors: "" };
  try {
    const records = getRecords(bytes);
    if (records.length === 0) return fallback;
    const rec0 = bytes.subarray(records[0]!.offset, records[0]!.end);

    const mobi = getStruct(MOBI_HEADER, rec0) as Record<string, number> & {
      magic: string;
    };
    if (mobi.magic !== "MOBI") return fallback;

    const encoding = MOBI_ENCODING[mobi["encoding"] as number] || "utf-8";
    const decoder = safeDecoder(encoding);

    const rawTitle = decoder.decode(
      rec0.subarray(
        mobi["titleOffset"] as number,
        (mobi["titleOffset"] as number) + (mobi["titleLength"] as number),
      ),
    );

    const mobiLanguage = (() => {
      const langs = MOBI_LANG[mobi["localeLanguage"] as number];
      if (!langs) return undefined;
      const region = (mobi["localeRegion"] as number) >> 2;
      return langs[region] ?? langs[0] ?? undefined;
    })();

    // EXTH block present iff bit 6 of exthFlag is set.
    let exth: Record<string, unknown> = {};
    if (((mobi["exthFlag"] as number) & 0b100_0000) !== 0) {
      const exthStart = (mobi["length"] as number) + 16;
      if (exthStart + 12 <= rec0.byteLength) {
        exth = getEXTH(rec0.subarray(exthStart), encoding);
      }
    }

    const title = unescapeHTML((exth["title"] as string) || rawTitle || fallbackTitle);
    const creators = (exth["creator"] as string[] | undefined) || [];
    const authors = creators.map((c) => unescapeHTML(c)).join(", ");
    // EXTH 524 (language) is a "many" field, so it accumulates into an array;
    // take the first value.
    const exthLanguage = Array.isArray(exth["language"])
      ? (exth["language"][0] as string | undefined)
      : (exth["language"] as string | undefined);
    const language = exthLanguage || mobiLanguage || undefined;
    const identifier = mobi["uid"] != null ? String(mobi["uid"]) : undefined;

    const cover = getCover(bytes, records, mobi, exth);

    return { title, authors, language, identifier, cover };
  } catch {
    return fallback;
  }
}

const NON_IMAGE_MAGIC = ["FONT", "VIDE", "AUDI"];

function getCover(
  bytes: Uint8Array,
  records: PdbRecordRange[],
  mobi: Record<string, number>,
  exth: Record<string, unknown>,
): BookCover | undefined {
  const coverOffset = exth["coverOffset"] as number | undefined;
  const thumbnailOffset = exth["thumbnailOffset"] as number | undefined;
  const offset =
    coverOffset != null && coverOffset < 0xffffffff
      ? coverOffset
      : thumbnailOffset != null && thumbnailOffset < 0xffffffff
        ? thumbnailOffset
        : null;
  if (offset == null) return undefined;

  const resourceStart = mobi["resourceStart"] as number;
  const index = resourceStart + offset;
  if (index < 0 || index >= records.length) return undefined;

  const data = bytes.subarray(records[index]!.offset, records[index]!.end);
  if (data.byteLength < 4) return undefined;

  // Skip records that are actually fonts/video/audio, not images.
  const magic4 = getString(data.subarray(0, 4));
  if (NON_IMAGE_MAGIC.includes(magic4)) return undefined;

  const mime = imageMimeFromMagic(data);
  if (!mime) return undefined;
  const ext = MIME_EXT[mime] || "jpg";
  return { bytes: data, mime, ext };
}
