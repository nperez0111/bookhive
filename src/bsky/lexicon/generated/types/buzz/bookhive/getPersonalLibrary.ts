import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getPersonalLibrary", {
  params: /*#__PURE__*/ v.object({
    /**
     * Pagination cursor
     */
    cursor: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * Maximum number of books to return
     * @minimum 1
     * @maximum 100
     * @default 24
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1, 100)]),
      24,
    ),
    /**
     * Case-insensitive substring match against title or authors. Mirrors the OPDS search feed.
     * @minLength 1
     * @maxLength 256
     */
    q: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(1, 256)]),
    ),
    /**
     * Filter by personal shelf ID
     */
    shelfId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * Result ordering. `recent` is newest-added first (the default, matching the library page and the OPDS /all feed); `title` and `author` are ascending alphabetical, matching the OPDS search results feed. Not switched implicitly when `q` is set — pass it explicitly.
     * @default "recent"
     */
    sort: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.string<"author" | "recent" | "title" | (string & {})>(),
      "recent",
    ),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get books() {
        return /*#__PURE__*/ v.array(personalBookViewSchema);
      },
      /**
       * Pagination cursor for the next page
       */
      cursor: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
      /**
       * This user's storage usage against their quota
       */
      get storage() {
        return /*#__PURE__*/ v.optional(storageViewSchema);
      },
      /**
       * Total number of books matching the query, across all pages
       */
      total: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    }),
  },
});
const _personalBookViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getPersonalLibrary#personalBookView"),
  ),
  /**
   * Authors of the book (tab-separated)
   */
  authors: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * SHA-256 hash of the file content, used as stable identifier
   */
  contentHash: /*#__PURE__*/ v.string(),
  /**
   * URL of the book cover image. When it points at the public catalog image proxy it needs no authentication; the `/library/covers/...` form is session-authenticated, so a client using service auth should use `hasLocalCover` and getPersonalBookCover instead.
   */
  coverUrl: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * When the book was added to the library
   */
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * Synopsis from the linked BookHive catalog entry. Deliberately unbounded: this is scraped catalog copy, not user input, and 125 of the 367k descriptions in production already exceed 5000 bytes (longest 10386). A maxLength here would be a contract the data violates, and enforcing it would mean truncating a synopsis mid-sentence.
   */
  description: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Original uploaded file name. A sync client needs this to correlate the book with what is on the device.
   */
  filename: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * File format (e.g. epub, pdf, mobi, fb2, cbz)
   */
  format: /*#__PURE__*/ v.string(),
  /**
   * Whether a cover extracted from the uploaded file is stored. Fetch it with getPersonalBookCover, which works under any supported authentication.
   */
  hasLocalCover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
  /**
   * Linked BookHive catalog entry ID
   */
  hiveId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Language of the book
   */
  language: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * MIME type of the file
   */
  mime: /*#__PURE__*/ v.string(),
  /**
   * E-reader reading progress, when this book has been synced
   */
  get progress() {
    return /*#__PURE__*/ v.optional(syncProgressViewSchema);
  },
  /**
   * IDs of the personal shelves this book belongs to
   */
  shelfIds: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(/*#__PURE__*/ v.integer())),
  /**
   * File size in bytes
   */
  sizeBytes: /*#__PURE__*/ v.integer(),
  /**
   * Title of the book
   */
  title: /*#__PURE__*/ v.string(),
  /**
   * When the book record was last updated
   */
  updatedAt: /*#__PURE__*/ v.datetimeString(),
});
const _storageViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getPersonalLibrary#storageView"),
  ),
  /**
   * Total bytes this user is allowed to store
   * @minimum 0
   */
  quotaBytes: /*#__PURE__*/ v.integer(),
  /**
   * Total bytes currently stored for this user
   * @minimum 0
   */
  usedBytes: /*#__PURE__*/ v.integer(),
});
const _syncProgressViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getPersonalLibrary#syncProgressView"),
  ),
  /**
   * Name of the device that last reported progress
   */
  device: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Reading progress as a fraction between 0 and 1
   */
  percentage: /*#__PURE__*/ v.string(),
  /**
   * When progress was last synced
   */
  updatedAt: /*#__PURE__*/ v.datetimeString(),
});
type main$schematype = typeof _mainSchema;
type personalBookView$schematype = typeof _personalBookViewSchema;
type storageView$schematype = typeof _storageViewSchema;
type syncProgressView$schematype = typeof _syncProgressViewSchema;

export interface mainSchema extends main$schematype {}

export interface personalBookViewSchema extends personalBookView$schematype {}

export interface storageViewSchema extends storageView$schematype {}

export interface syncProgressViewSchema extends syncProgressView$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const personalBookViewSchema = _personalBookViewSchema as personalBookViewSchema;
export const storageViewSchema = _storageViewSchema as storageViewSchema;
export const syncProgressViewSchema = _syncProgressViewSchema as syncProgressViewSchema;

export interface PersonalBookView extends v.InferInput<typeof personalBookViewSchema> {}

export interface StorageView extends v.InferInput<typeof storageViewSchema> {}

export interface SyncProgressView extends v.InferInput<typeof syncProgressViewSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getPersonalLibrary": mainSchema;
  }
}
