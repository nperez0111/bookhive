import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.addToList", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Optional note about this book in the list
       * @maxLength 5000
       */
      description: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
          /*#__PURE__*/ v.stringLength(0, 5000),
        ]),
      ),
      /**
       * Hive ID of the book to add
       */
      hiveId: /*#__PURE__*/ v.string(),
      /**
       * AT-URI of the list
       */
      listUri: /*#__PURE__*/ v.string(),
      /**
       * Position in the list (for ordered lists)
       */
      position: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
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
    "buzz.bookhive.addToList": mainSchema;
  }
}
