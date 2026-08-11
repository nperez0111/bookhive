/**
 * Filename-derived identity for e-reader documents.
 *
 * KOSync clients identify a document one of two ways (KOReader's
 * `CHECKSUM_METHOD`, plugins/kosync.koplugin/main.lua):
 *
 * - `BINARY` (0, the default) — `md5` over 1 KiB samples of the file itself.
 *   That is `koreaderPartialMD5` in `bookMetadata/hash.ts`, and it is what
 *   `personal_book.contentHash` stores, which is why an uploaded file lines up
 *   with its synced progress by hash alone.
 * - `FILENAME` (1) — plain `md5(basename)`, nothing to do with the bytes.
 *   Users switch to it precisely *because* their files are not byte-identical
 *   across devices (calibre conversion, image downscaling), so for those users
 *   the content hash can never match. `koreaderFilenameHash` reproduces it.
 *
 * Separately, KOReader's `send_metadata` option (and CrossPoint, which sends it
 * unconditionally) puts the human-readable filename in the progress payload. A
 * filename is often the *only* usable signal we get: plenty of documents arrive
 * with no title/author metadata at all, and "Ursula K. Le Guin - The
 * Dispossessed.epub" identifies a book perfectly well.
 *
 * Three derived values, used in that order of confidence:
 *
 * | value                   | matches                                    | fuzzy? |
 * | ----------------------- | ------------------------------------------ | ------ |
 * | `koreaderFilenameHash`  | a FILENAME-mode `sync_document.documentHash` | no    |
 * | `filenameKey`           | another file's normalized name              | a bit |
 * | `filenameBookCandidates`| a `hive_book` title/author                  | yes   |
 */

import { contentWords } from "./bookMatching";

/**
 * Extensions stripped before comparing two filenames. Deliberately a closed
 * list rather than a `\.\w+$` regex: a generic strip mangles titles that end in
 * a dot-number ("Foundation Vol.2", "Hitchhiker's 1.5"), and the whole point of
 * the key is that two names for the same book collapse onto it.
 *
 * Conversion changes the extension — the .epub on the desktop is the .azw3 on
 * the Kindle — so stripping it is what makes the key survive a calibre round
 * trip at all.
 */
const EBOOK_EXTENSIONS = new Set([
  "epub",
  "kepub",
  "mobi",
  "azw",
  "azw3",
  "azw4",
  "prc",
  "pdb",
  "fb2",
  "cbz",
  "cbr",
  "cb7",
  "pdf",
  "djvu",
  "djv",
  "txt",
  "rtf",
  "doc",
  "docx",
  "html",
  "htm",
  "xhtml",
  "chm",
  "lit",
  "opf",
  "zip",
  "gz",
]);

/** Parenthesised groups that are release noise, not part of the title. */
const JUNK_PAREN =
  /^(z-?lib(rary)?(\.org)?|libgen|anna'?s? archive|retail|repack|v\d+(\.\d+)*|\d+|epub|mobi|azw3?|pdf|scan|ocr|copy|dup(licate)?|final|fixed)$/i;

const SEPARATORS = /\s+[-–—_]\s+/;

export type FilenameCandidate = {
  title: string;
  /** null when the filename yielded no author signal at all. */
  authors: string | null;
};

/** Last path segment, tolerating both separators (KOReader runs on Windows too). */
export function filenameBasename(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * `md5` of the basename — byte-for-byte what a KOSync client in FILENAME
 * checksum mode sends as its `document` id. Matching this against
 * `sync_document.documentHash` is exact, not fuzzy: it is the same protocol
 * identifier, just computed on our side.
 */
export function koreaderFilenameHash(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const name = filenameBasename(filename).trim();
  if (!name) return null;
  return new Bun.CryptoHasher("md5").update(name, "utf8").digest("hex");
}

/** Strip a known ebook extension (including the `.fb2.zip` double form). */
function stripExtension(name: string): string {
  let out = name;
  for (let i = 0; i < 2; i++) {
    const dot = out.lastIndexOf(".");
    if (dot <= 0) break;
    const ext = out.slice(dot + 1).toLowerCase();
    if (!EBOOK_EXTENSIONS.has(ext)) break;
    out = out.slice(0, dot);
  }
  return out;
}

/**
 * Everything both the key and the candidate parser want: basename, no
 * extension, no `[...]` groups, no release-noise `(...)` groups, underscores
 * read as spaces, whitespace collapsed.
 */
function cleanFilename(filename: string): string {
  let name = stripExtension(filenameBasename(filename));
  name = name.replace(/\[[^\]]*\]/g, " ");
  name = name.replace(/\(([^)]*)\)/g, (whole, inner: string) =>
    JUNK_PAREN.test(inner.trim()) ? " " : whole,
  );
  name = name.replace(/_/g, " ");
  return name.replace(/\s+/g, " ").trim();
}

/**
 * Comparison key for "are these two files the same book". Folds case,
 * punctuation and the extension away, so `Dune - Frank Herbert.epub` and
 * `dune_-_frank_herbert.azw3` land on `dune frank herbert`.
 *
 * Returns null when nothing indexable survives, which callers must treat as
 * "no key" rather than as a value to match on — otherwise every metadata-less
 * document would match every other one.
 */
export function filenameKey(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const key = cleanFilename(filename)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return key || null;
}

/** Diacritics folded away, so the ASCII-only helpers in `bookMatching` behave. */
function foldDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/\p{M}+/gu, "");
}

/** Diacritics folded, series/edition tail dropped, punctuation still intact. */
function titleBody(title: string): string {
  // Tails: "Dune (Dune Chronicles #1)", "Emma [Illustrated]".
  return foldDiacritics(title)
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]\s*$/g, "")
    .trim();
}

/** Normalized form used to compare a filename-derived title to a `hive_book` one. */
export function normalizeTitle(title: string): string {
  return titleBody(title)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether two titles name the same book.
 *
 * Equal normalized strings, or the same set of significant words in any order
 * — which buys tolerance for punctuation ("Hitchhiker's" / "Hitchhikers"),
 * stop words ("The Hobbit" / "Hobbit") and ordering, all of which vary between
 * a filename and a Goodreads title without changing the book.
 *
 * The word gate runs in **both** directions, unlike `contentWordsMatch`'s
 * one-way containment. One-way is right for a CSV import, where the row has
 * other identifiers to fall back on; here it would accept "Dune" against "Dune
 * Messiah" — a real, different book, by the same author, so the author check
 * downstream would wave it through and write the user's progress onto it.
 */
export function titlesEquivalent(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // From the punctuated body, not from `na`/`nb`: `normalizeTitle` turns
  // punctuation into a space, which splits "hitchhiker's" into two words, while
  // `contentWords` deletes it and yields the one word "hitchhikers".
  const wa = contentWords(titleBody(a));
  const wb = contentWords(titleBody(b));
  // Empty on both sides means neither title survived ASCII normalization (a
  // CJK or Cyrillic title, or one made entirely of stop words). That is not
  // agreement — fall back to the string equality already tested above.
  if (wa.length === 0 || wb.length === 0) return false;
  if (wa.length !== wb.length) return false;
  const sortedA = [...wa].sort();
  const sortedB = [...wb].sort();
  return sortedA.every((w, i) => w === sortedB[i]);
}

/** Normalized form of a single personal name, with `Last, First` un-inverted. */
export function normalizeAuthor(author: string): string {
  let name = author.trim();
  const comma = name.indexOf(",");
  if (comma > 0 && !name.slice(comma + 1).includes(",")) {
    name = `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
  }
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether two author strings plausibly name the same person.
 *
 * Deliberately not a similarity score: each rule below is one concrete way the
 * same author is written differently across a filename and Goodreads, and
 * anything else is a miss. Initials are the interesting case — "J R R Tolkien"
 * and "John Ronald Reuel Tolkien" agree on a surname and a first initial only.
 * Comparing initials is therefore allowed, but only when one side actually *is*
 * an initial: two spelled-out first names must be equal, or "Jane Tolkien" and
 * "John Tolkien" would be the same person.
 */
export function authorsMatch(a: string, b: string): boolean {
  const x = normalizeAuthor(a);
  const y = normalizeAuthor(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const xs = x.split(" ");
  const ys = y.split(" ");
  const xSurname = xs[xs.length - 1];
  const ySurname = ys[ys.length - 1];
  if (!xSurname || !ySurname || xSurname !== ySurname) return false;
  // Single-token names ("Homer", "Plato") are already covered by equality; a
  // surname-only match against a full name is too weak to accept.
  if (xs.length === 1 || ys.length === 1) return false;

  const xFirst = xs[0]!;
  const yFirst = ys[0]!;
  if (xFirst === yFirst) return true;
  if (xFirst.length > 1 && yFirst.length > 1) return false;
  return xFirst[0] === yFirst[0];
}

function pushCandidate(out: FilenameCandidate[], title: string, authors: string | null): void {
  const t = title.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, "");
  const a = authors?.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, "") || null;
  // A "title" of one or two characters is a series index or a stray token, not
  // something worth hashing against the whole catalogue.
  if (t.length < 3) return;
  if (a !== null && a.length < 2) return;
  if (out.some((c) => c.title === t && c.authors === a)) return;
  out.push({ title: t, authors: a });
}

/**
 * Title/author guesses for a filename, most confident first.
 *
 * Both orderings of an `A - B` split are emitted, because both conventions are
 * in the wild (calibre writes `Title - Author`, most torrents write `Author -
 * Title`) and nothing in the string says which one this is. That is safe to do
 * blindly *because* the caller resolves them against the catalogue: `hive_book.id`
 * is a hash of title+author, so a wrong ordering simply hashes to an id that
 * does not exist. Guessing costs a lookup, never a wrong link.
 */
export function filenameBookCandidates(filename: string | null | undefined): FilenameCandidate[] {
  if (!filename) return [];
  const cleaned = cleanFilename(filename);
  if (!cleaned) return [];

  const out: FilenameCandidate[] = [];

  // "The Dispossessed (Ursula K. Le Guin)" — a trailing parenthetical that
  // survived the junk filter is nearly always the author.
  const trailingParen = cleaned.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const body = trailingParen ? trailingParen[1]!.trim() : cleaned;
  if (trailingParen) pushCandidate(out, body, trailingParen[2]!);

  // Leading series index: "01 - The Fellowship of the Ring - J.R.R. Tolkien".
  let parts = body
    .split(SEPARATORS)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && /^\d{1,3}\.?$/.test(parts[0]!)) parts = parts.slice(1);

  if (parts.length === 2) {
    pushCandidate(out, parts[0]!, parts[1]!);
    pushCandidate(out, parts[1]!, parts[0]!);
  } else if (parts.length > 2) {
    const head = parts[0]!;
    const tail = parts[parts.length - 1]!;
    const middle = parts.slice(1).join(" - ");
    const front = parts.slice(0, -1).join(" - ");
    // Either end can be the author; the rest is the title.
    pushCandidate(out, middle, head);
    pushCandidate(out, front, tail);
  }

  // Whole name as a title, with whatever author signal we found. Last resort,
  // but it is the only candidate for a bare "The Dispossessed.epub".
  pushCandidate(out, parts.join(" - "), null);

  return out;
}
