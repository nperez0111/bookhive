import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.createPersonalShelf", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Optional description of the shelf
       * @maxLength 500
       */
      description: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 500)]),
      ),
      /**
       * Name of the shelf
       * @minLength 1
       * @maxLength 100
       */
      name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(1, 100),
      ]),
    }),
  },
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get shelf() {
        return personalShelfViewSchema;
      },
    }),
  },
});
const _personalShelfViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.createPersonalShelf#personalShelfView"),
  ),
  /**
   * Number of books on this shelf
   * @minimum 0
   */
  bookCount: /*#__PURE__*/ v.integer(),
  /**
   * When the shelf was created
   */
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * Description of the shelf
   */
  description: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Unique shelf identifier
   */
  id: /*#__PURE__*/ v.integer(),
  /**
   * Name of the shelf
   */
  name: /*#__PURE__*/ v.string(),
  /**
   * When the shelf was last updated
   */
  updatedAt: /*#__PURE__*/ v.datetimeString(),
});
type main$schematype = typeof _mainSchema;
type personalShelfView$schematype = typeof _personalShelfViewSchema;

export interface mainSchema extends main$schematype {}

export interface personalShelfViewSchema extends personalShelfView$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const personalShelfViewSchema = _personalShelfViewSchema as personalShelfViewSchema;

export interface PersonalShelfView extends v.InferInput<typeof personalShelfViewSchema> {}

export interface $params {}

export interface $input extends v.InferXRPCBodyInput<mainSchema["input"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.createPersonalShelf": mainSchema;
  }
}
