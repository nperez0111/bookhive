import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveHiveBook from "./hiveBook.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.searchBooks", {
  params: /*#__PURE__*/ v.object({
    /**
     * The ID of the book within the hive.
     */
    id: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * @minimum 1
     * @maximum 100
     * @default 25
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 100),
      ]),
      25,
    ),
    /**
     * Offset for pagination into the result set
     */
    offset: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * Search query string. Will be matched against title and authors fields.
     */
    q: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get books() {
        return /*#__PURE__*/ v.array(BuzzBookhiveHiveBook.mainSchema);
      },
      /**
       * The next offset to use for pagination (result of limit + offset)
       */
      offset: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
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
    "buzz.bookhive.searchBooks": mainSchema;
  }
}
