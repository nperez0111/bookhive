import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.listSyncDocuments", {
  params: /*#__PURE__*/ v.object({}),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get documents() {
        return /*#__PURE__*/ v.array(syncDocumentViewSchema);
      },
    }),
  },
});
const _syncDocumentViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.listSyncDocuments#syncDocumentView"),
  ),
  /**
   * Authors of the document
   */
  authors: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Device name that last synced
   */
  device: /*#__PURE__*/ v.string(),
  /**
   * Device identifier that last synced
   */
  device_id: /*#__PURE__*/ v.string(),
  /**
   * Hash identifying the document
   */
  documentHash: /*#__PURE__*/ v.string(),
  /**
   * Original filename of the document
   */
  filename: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Linked BookHive catalog entry ID
   */
  hiveId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
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
  /**
   * Title of the document
   */
  title: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
type main$schematype = typeof _mainSchema;
type syncDocumentView$schematype = typeof _syncDocumentViewSchema;

export interface mainSchema extends main$schematype {}

export interface syncDocumentViewSchema extends syncDocumentView$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const syncDocumentViewSchema = _syncDocumentViewSchema as syncDocumentViewSchema;

export interface SyncDocumentView extends v.InferInput<typeof syncDocumentViewSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.listSyncDocuments": mainSchema;
  }
}
