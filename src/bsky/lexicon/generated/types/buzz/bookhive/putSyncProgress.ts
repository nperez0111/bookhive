import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.putSyncProgress", {
  params: null,
  input: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Device name
       */
      device: /*#__PURE__*/ v.string(),
      /**
       * Device identifier
       */
      device_id: /*#__PURE__*/ v.string(),
      /**
       * Document identifier
       */
      document: /*#__PURE__*/ v.string(),
      get metadata() {
        return /*#__PURE__*/ v.optional(syncMetadataSchema);
      },
      /**
       * Reading progress as a decimal string (0-1, e.g. '0.42')
       */
      percentage: /*#__PURE__*/ v.string(),
      /**
       * Reading progress position (KOSync format)
       */
      progress: /*#__PURE__*/ v.string(),
    }),
  },
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Result status of the operation
       */
      status: /*#__PURE__*/ v.string(),
    }),
  },
});
const _syncMetadataSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.putSyncProgress#syncMetadata"),
  ),
  /**
   * Authors of the document
   */
  authors: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Original filename of the document
   */
  filename: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Title of the document
   */
  title: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
type main$schematype = typeof _mainSchema;
type syncMetadata$schematype = typeof _syncMetadataSchema;

export interface mainSchema extends main$schematype {}

export interface syncMetadataSchema extends syncMetadata$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const syncMetadataSchema = _syncMetadataSchema as syncMetadataSchema;

export interface SyncMetadata extends v.InferInput<typeof syncMetadataSchema> {}

export interface $params {}

export interface $input extends v.InferXRPCBodyInput<mainSchema["input"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.putSyncProgress": mainSchema;
  }
}
