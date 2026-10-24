import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _authorSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.listAuthors#author")),
  author: /*#__PURE__*/ v.string(),
  /**
   * Average catalogue rating on a 0-5 scale multiplied by 10, matching getExplore.
   * @minimum 0
   * @maximum 50
   */
  avgRating: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(0, 50)]),
  ),
  /**
   * @minimum 0
   */
  bookCount: /*#__PURE__*/ v.integer(),
  /**
   * @minimum 0
   */
  totalRatings: /*#__PURE__*/ v.integer(),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.listAuthors", {
  params: /*#__PURE__*/ v.object({
    /**
     * Restrict directory statistics to a supported catalogue language, matching the web directory. Unsupported languages fall back to all languages.
     * @maxLength 100
     */
    language: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 100)]),
    ),
    /**
     * @minimum 1
     * @maximum 100
     * @default 50
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1, 100)]),
      50,
    ),
    /**
     * @minimum 0
     * @maximum 500
     * @default 0
     */
    offset: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(0, 500)]),
      0,
    ),
    /**
     * Case-insensitive substring of author name, trimmed and applied before pagination.
     * @maxLength 200
     */
    q: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 200)]),
    ),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get authors() {
        return /*#__PURE__*/ v.array(authorSchema);
      },
      /**
       * Maximum directory size before the optional name filter (500).
       */
      directoryLimit: /*#__PURE__*/ v.integer(),
      hasMore: /*#__PURE__*/ v.boolean(),
      /**
       * Next offset into the filtered directory.
       * @minimum 0
       */
      offset: /*#__PURE__*/ v.integer(),
      /**
       * Number matching q within the bounded directory, not a whole-catalogue author count.
       * @minimum 0
       * @maximum 500
       */
      total: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(0, 500),
      ]),
    }),
  },
});
type author$schematype = typeof _authorSchema;
type main$schematype = typeof _mainSchema;

export interface authorSchema extends author$schematype {}

export interface mainSchema extends main$schematype {}
export const authorSchema = _authorSchema as authorSchema;
export const mainSchema = _mainSchema as mainSchema;

export interface Author extends v.InferInput<typeof authorSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.listAuthors": mainSchema;
  }
}
