import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveHiveBook from "./hiveBook.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getAuthorBooks", {
  params: /*#__PURE__*/ v.object({
    /**
     * The author name to look up
     */
    author: /*#__PURE__*/ v.string(),
    /**
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
     * @minimum 1
     * @default 1
     */
    page: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1),
      ]),
      1,
    ),
    /**
     * Sort order. Defaults to popularity.
     */
    sort: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.string<"popularity" | "reviews" | (string & {})>(),
    ),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      author: /*#__PURE__*/ v.string(),
      get books() {
        return /*#__PURE__*/ v.array(BuzzBookhiveHiveBook.mainSchema);
      },
      page: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
      totalBooks: /*#__PURE__*/ v.integer(),
      totalPages: /*#__PURE__*/ v.integer(),
    }),
  },
});

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getAuthorBooks": mainSchema;
  }
}
