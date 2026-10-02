// Helpers shared by the per-format metadata parsers.

/** Decode the common XML/HTML character entities. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

/** Alias used by the MOBI parser to mirror foliate-js naming. */
export const unescapeHTML = decodeXmlEntities;

/** Map an image MIME type to a file extension. */
export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** Normalise an extension (jpeg -> jpg) and look up its MIME type. */
export function mimeForExt(ext: string): string {
  const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
  const found = Object.entries(MIME_EXT).find(([, v]) => v === e);
  return found ? found[0] : "application/octet-stream";
}

/** Detect an image MIME type from the leading magic bytes. */
export function imageMimeFromMagic(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return undefined;
}

/** Decode a base64 string to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64.replace(/\s+/g, ""), "base64"));
}

/** Read an attribute value from a raw element tag string. */
export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : undefined;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

/** Returns true if the bytes begin with a local ZIP file header. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === ZIP_MAGIC[0] &&
    bytes[1] === ZIP_MAGIC[1] &&
    bytes[2] === ZIP_MAGIC[2] &&
    bytes[3] === ZIP_MAGIC[3]
  );
}

/** Extension of a filename, lowercased, without the dot ("" if none). */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || filename;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}
