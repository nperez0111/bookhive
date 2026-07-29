import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveGetPersonalLibrary from "./getPersonalLibrary.js";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.uploadPersonalBook", {
  params: null,
  input: { type: "blob" },
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
export type $input = v.InferXRPCBodyInput<mainSchema["input"]>;

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.uploadPersonalBook": mainSchema;
  }
}
