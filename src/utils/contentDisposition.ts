/**
 * `Content-Disposition: attachment` header construction.
 *
 * Split out from the download paths because getting it wrong is silent: the
 * response is a valid 200 carrying the right bytes, and the file just lands on
 * the reader under the wrong name — or under a name with no extension, which
 * some e-readers then refuse to open.
 */

/**
 * RFC 8187 `attr-char`. Everything else in an ext-value must be percent-encoded.
 *
 * This is deliberately *not* `encodeURIComponent`, which was the previous
 * implementation and is wrong here: it leaves `' ( ) * ! ~` unescaped, none of
 * which are attr-char. The apostrophe is the one that actually breaks parsers,
 * because it is the delimiter between charset, language and value — so
 * `The Handmaid's Tale.epub` encoded with `encodeURIComponent` produces
 *
 *     filename*=UTF-8''The%20Handmaid's%20Tale.epub
 *
 * which a strict reader parses as charset `UTF-8`, language `The%20Handmaid`,
 * value `s%20Tale.epub`, or rejects outright.
 */
const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** Percent-encode a filename as an RFC 8187 ext-value (UTF-8, no language). */
function encodeExtValue(filename: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(filename)) {
    const char = String.fromCharCode(byte);
    out += ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * Make a value safe to sit inside RFC 9110 §5.6.4 `quoted-string`.
 *
 * Control characters are dropped outright — they cannot be escaped, and a bare
 * CR or LF in a header value is response splitting — and the two characters
 * that *are* significant inside the quotes are backslash-escaped.
 */
function quotedString(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/(["\\])/g, "\\$1");
}

/**
 * Build a `Content-Disposition: attachment` value carrying both parameter
 * forms.
 *
 * Both are needed. RFC 6266 §4.3 has `filename*` win wherever it is understood,
 * which is what carries non-ASCII titles intact; but a client that implements
 * only the plain `filename` — or none of it — otherwise has nothing to fall
 * back to but the URL's last path segment.
 *
 * `asciiName` is passed in rather than derived here so it can be the *same*
 * string the download URL ends in (`canonicalDownloadFilename`). A client that
 * reads the header and one that scrapes the URL then save the same name.
 *
 * It is still re-checked here rather than trusted. `canonicalDownloadFilename`
 * reduces to `[A-Za-z0-9._-]` so today nothing can reach the quoted-string, but
 * this is an exported helper and a future caller passing a raw filename
 * through would otherwise be able to close the quote and append parameters of
 * its own.
 */
export function attachmentDisposition(filename: string, asciiName: string): string {
  return `attachment; filename="${quotedString(asciiName)}"; filename*=UTF-8''${encodeExtValue(filename)}`;
}
