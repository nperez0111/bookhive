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
     * Filter by personal shelf ID
     */
    shelfId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
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
   * URL of the book cover image
   */
  coverUrl: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * When the book was added to the library
   */
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * File format (e.g. epub, pdf, mobi, fb2, cbz)
   */
  format: /*#__PURE__*/ v.string(),
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
type main$schematype = typeof _mainSchema;
type personalBookView$schematype = typeof _personalBookViewSchema;

export interface mainSchema extends main$schematype {}

export interface personalBookViewSchema extends personalBookView$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const personalBookViewSchema = _personalBookViewSchema as personalBookViewSchema;

export interface PersonalBookView extends v.InferInput<typeof personalBookViewSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getPersonalLibrary": mainSchema;
  }
}
