import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.removeFromList", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * AT-URI of the list item to remove
       */
      itemUri: /*#__PURE__*/ v.string(),
    }),
  },
  output: null,
});

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface $params {}
export interface $input extends v.InferXRPCBodyInput<mainSchema["input"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.removeFromList": mainSchema;
  }
}
