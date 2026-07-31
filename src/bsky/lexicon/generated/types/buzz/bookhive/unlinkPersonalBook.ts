import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveGetPersonalLibrary from "./getPersonalLibrary.js";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.unlinkPersonalBook", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * SHA-256 hash of the file content
       */
      contentHash: /*#__PURE__*/ v.string(),
    }),
  },
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

export interface $params {}

export interface $input extends v.InferXRPCBodyInput<mainSchema["input"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.unlinkPersonalBook": mainSchema;
  }
}
