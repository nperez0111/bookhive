import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveGetList from "./getList.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getUserLists", {
  params: /*#__PURE__*/ v.object({
    /**
     * DID of the user whose lists to fetch
     */
    did: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get lists() {
        return /*#__PURE__*/ v.array(BuzzBookhiveGetList.listViewSchema);
      },
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
    "buzz.bookhive.getUserLists": mainSchema;
  }
}
