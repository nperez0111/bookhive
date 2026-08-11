import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveCreatePersonalShelf from "./createPersonalShelf.js";
import * as BuzzBookhiveGetPersonalLibrary from "./getPersonalLibrary.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.listPersonalShelves", {
  params: null,
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get shelves() {
        return /*#__PURE__*/ v.array(BuzzBookhiveCreatePersonalShelf.personalShelfViewSchema);
      },
      /**
       * This user's storage usage against their quota
       */
      get storage() {
        return /*#__PURE__*/ v.optional(BuzzBookhiveGetPersonalLibrary.storageViewSchema);
      },
      /**
       * Books in the library across all shelves and unshelved
       * @minimum 0
       */
      totalBooks: /*#__PURE__*/ v.integer(),
    }),
  },
});
type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}
export const mainSchema = _mainSchema as mainSchema;

export interface $params {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.listPersonalShelves": mainSchema;
  }
}
