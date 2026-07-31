import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveCreatePersonalShelf from "./createPersonalShelf.js";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.updatePersonalShelf", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * New description for the shelf
       * @maxLength 500
       */
      description: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 500)]),
      ),
      /**
       * ID of the shelf to update
       */
      id: /*#__PURE__*/ v.integer(),
      /**
       * New name for the shelf
       * @minLength 1
       * @maxLength 100
       */
      name: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(1, 100)]),
      ),
    }),
  },
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get shelf() {
        return BuzzBookhiveCreatePersonalShelf.personalShelfViewSchema;
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
    "buzz.bookhive.updatePersonalShelf": mainSchema;
  }
}
