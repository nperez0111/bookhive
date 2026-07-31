import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveGetPersonalLibrary from "./getPersonalLibrary.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getPersonalBook", {
  params: /*#__PURE__*/ v.object({
    /**
     * SHA-256 hash of the file content
     */
    contentHash: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get book() {
        return BuzzBookhiveGetPersonalLibrary.personalBookViewSchema;
      },
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
    "buzz.bookhive.getPersonalBook": mainSchema;
  }
}
