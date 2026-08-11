import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveGetPersonalLibrary from "./getPersonalLibrary.js";

const _mainSchema = /*#__PURE__*/ v.procedure("buzz.bookhive.uploadPersonalBook", {
  params: /*#__PURE__*/ v.object({
    /**
     * Original file name including extension. Required: the extension is the only thing distinguishing the zip-container formats (.epub / .cbz / .fb2.zip) from each other, and it is the key used to match e-reader sync documents to this file.
     * @minLength 1
     * @maxLength 512
     */
    filename: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 512),
    ]),
  }),
  input: {
    type: "blob",
    encoding: [
      "application/epub+zip",
      "application/x-mobipocket-ebook",
      "application/vnd.amazon.ebook",
      "application/vnd.amazon.mobi8-ebook",
      "application/x-fictionbook+xml",
      "application/vnd.comicbook+zip",
      "application/x-cbz",
      "application/zip",
      "application/octet-stream",
    ],
  },
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get book() {
        return BuzzBookhiveGetPersonalLibrary.personalBookViewSchema;
      },
      /**
       * Total bytes this user is allowed to store
       * @minimum 0
       */
      storageQuotaBytes: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
      /**
       * Total bytes stored for this user after the upload
       * @minimum 0
       */
      storageUsedBytes: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    }),
  },
});
type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}
export const mainSchema = _mainSchema as mainSchema;

export interface $params extends v.InferInput<mainSchema["params"]> {}
export type $input = v.InferXRPCBodyInput<mainSchema["input"]>;

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCProcedures {
    "buzz.bookhive.uploadPersonalBook": mainSchema;
  }
}
