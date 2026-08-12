import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getPersonalBookCover", {
  params: /*#__PURE__*/ v.object({
    /**
     * Content hash identifying the book
     */
    contentHash: /*#__PURE__*/ v.string(),
    /**
     * Requested width in pixels for the catalog-cover redirect. Ignored for locally stored covers, which are served at the size they were extracted at.
     * @minimum 32
     * @maximum 1024
     * @default 300
     */
    width: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(32, 1024),
      ]),
      300,
    ),
  }),
  output: {
    type: "blob",
    encoding: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
});
type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}
export const mainSchema = _mainSchema as mainSchema;

export interface $params extends v.InferInput<mainSchema["params"]> {}
export type $output = v.InferXRPCBodyInput<mainSchema["output"]>;
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getPersonalBookCover": mainSchema;
  }
}
