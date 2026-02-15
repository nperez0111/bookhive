import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveDefs from "./defs.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getProfile", {
  params: /*#__PURE__*/ v.object({
    /**
     * The user's DID to get the profile of
     */
    did: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * The user's handle to get the profile of
     */
    handle: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * The user's activity
       */
      get activity() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.activitySchema);
      },
      /**
       * All books in the user's library
       */
      get books() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.userBookSchema);
      },
      /**
       * The user's friend activity
       */
      get friendActivity() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.userBookSchema);
      },
      /**
       * The user's profile
       */
      get profile() {
        return BuzzBookhiveDefs.profileSchema;
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
    "buzz.bookhive.getProfile": mainSchema;
  }
}
