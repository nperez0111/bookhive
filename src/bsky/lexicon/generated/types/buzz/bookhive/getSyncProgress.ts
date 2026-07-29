import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getSyncProgress", {
  params: /*#__PURE__*/ v.object({
    /**
     * Content hash identifying the document
     */
    contentHash: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Device name that last synced
       */
      device: /*#__PURE__*/ v.string(),
      /**
       * Device identifier that last synced
       */
      device_id: /*#__PURE__*/ v.string(),
      /**
       * Document identifier
       */
      document: /*#__PURE__*/ v.string(),
      /**
       * Reading progress as a decimal string (0-1, e.g. '0.42')
       */
      percentage: /*#__PURE__*/ v.string(),
      /**
       * Reading progress position (KOSync format)
       */
      progress: /*#__PURE__*/ v.string(),
      /**
       * Unix timestamp of last sync
       */
      timestamp: /*#__PURE__*/ v.integer(),
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
    "buzz.bookhive.getSyncProgress": mainSchema;
  }
}
