import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _authorItemSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getExplore#authorItem")),
  author: /*#__PURE__*/ v.string(),
  /**
   * Average rating * 10 (e.g. 42 = 4.2 stars)
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
  thumbnail: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _genreItemSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getExplore#genreItem")),
  /**
   * @minimum 0
   */
  count: /*#__PURE__*/ v.integer(),
  genre: /*#__PURE__*/ v.string(),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getExplore", {
  params: /*#__PURE__*/ v.object({}),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get genres() {
        return /*#__PURE__*/ v.array(genreItemSchema);
      },
      get topAuthors() {
        return /*#__PURE__*/ v.array(authorItemSchema);
      },
    }),
  },
});

type authorItem$schematype = typeof _authorItemSchema;
type genreItem$schematype = typeof _genreItemSchema;
type main$schematype = typeof _mainSchema;

export interface authorItemSchema extends authorItem$schematype {}
export interface genreItemSchema extends genreItem$schematype {}
export interface mainSchema extends main$schematype {}

export const authorItemSchema = _authorItemSchema as authorItemSchema;
export const genreItemSchema = _genreItemSchema as genreItemSchema;
export const mainSchema = _mainSchema as mainSchema;

export interface AuthorItem extends v.InferInput<typeof authorItemSchema> {}
export interface GenreItem extends v.InferInput<typeof genreItemSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getExplore": mainSchema;
  }
}
