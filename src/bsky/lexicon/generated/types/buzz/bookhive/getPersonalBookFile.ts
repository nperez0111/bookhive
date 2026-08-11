import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getPersonalBookFile", {
  params: /*#__PURE__*/ v.object({
    /**
     * Content hash identifying the book, as returned by getPersonalLibrary
     */
    contentHash: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "blob",
    encoding: [
      "application/epub+zip",
      "application/x-mobipocket-ebook",
      "application/x-fictionbook+xml",
      "application/vnd.comicbook+zip",
      "application/octet-stream",
    ],
  },
});
type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}
export const mainSchema = _mainSchema as mainSchema;

export interface $params extends v.InferInput<mainSchema["params"]> {}
export type $output = v.InferXRPCBodyInput<mainSchema["output"]>;
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getPersonalBookFile": mainSchema;
  }
}
