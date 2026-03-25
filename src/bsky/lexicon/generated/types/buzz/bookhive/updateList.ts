import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.updateList", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * New description
       * @maxLength 500
       */
      description: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 500)]),
      ),
      /**
       * New name for the list
       * @minLength 1
       * @maxLength 100
       */
      name: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(1, 100)]),
      ),
      /**
       * Whether the list is ordered
       */
      ordered: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
      /**
       * New tags
       */
      tags: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.array(
          /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
            /*#__PURE__*/ v.stringLength(0, 50),
          ]),
        ),
      ),
      /**
       * AT-URI of the list to update
       */
      uri: /*#__PURE__*/ v.string(),
    }),
  },
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      cid: /*#__PURE__*/ v.string(),
      uri: /*#__PURE__*/ v.string(),
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
    "buzz.bookhive.updateList": mainSchema;
  }
}
