import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _genreWithCountSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.listGenres#genreWithCount"),
  ),
  /**
   * Number of books in this genre
   */
  count: /*#__PURE__*/ v.integer(),
  /**
   * Genre name
   */
  genre: /*#__PURE__*/ v.string(),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.listGenres", {
  params: /*#__PURE__*/ v.object({
    /**
     * Maximum number of genres to return
     * @minimum 1
     * @maximum 100
     * @default 50
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 100),
      ]),
      50,
    ),
    /**
     * Only return genres with at least this many books
     * @minimum 0
     * @default 0
     */
    minBooks: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer(), 0),
    /**
     * Offset for pagination
     */
    offset: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get genres() {
        return /*#__PURE__*/ v.array(genreWithCountSchema);
      },
      /**
       * Next offset for pagination
       */
      offset: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    }),
  },
});

type genreWithCount$schematype = typeof _genreWithCountSchema;
type main$schematype = typeof _mainSchema;

export interface genreWithCountSchema extends genreWithCount$schematype {}
export interface mainSchema extends main$schematype {}

export const genreWithCountSchema =
  _genreWithCountSchema as genreWithCountSchema;
export const mainSchema = _mainSchema as mainSchema;

export interface GenreWithCount extends v.InferInput<
  typeof genreWithCountSchema
> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.listGenres": mainSchema;
  }
}
