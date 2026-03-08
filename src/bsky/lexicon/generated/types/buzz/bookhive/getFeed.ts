import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _feedActivitySchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getFeed#feedActivity"),
  ),
  authors: /*#__PURE__*/ v.string(),
  cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  createdAt: /*#__PURE__*/ v.datetimeString(),
  hiveId: /*#__PURE__*/ v.string(),
  review: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * @minimum 1
   * @maximum 10
   */
  stars: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(1, 10),
    ]),
  ),
  status: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  thumbnail: /*#__PURE__*/ v.string(),
  title: /*#__PURE__*/ v.string(),
  userAvatar: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  userDid: /*#__PURE__*/ v.string(),
  userHandle: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getFeed", {
  params: /*#__PURE__*/ v.object({
    /**
     * @minimum 1
     * @maximum 50
     * @default 25
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 50),
      ]),
      25,
    ),
    /**
     * Page number for pagination
     * @minimum 1
     * @default 1
     */
    page: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1),
      ]),
      1,
    ),
    /**
     * Which feed tab to show. Defaults to friends.
     */
    tab: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.string<"all" | "friends" | "tracking" | (string & {})>(),
    ),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get activities() {
        return /*#__PURE__*/ v.array(feedActivitySchema);
      },
      hasMore: /*#__PURE__*/ v.boolean(),
      page: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    }),
  },
});

type feedActivity$schematype = typeof _feedActivitySchema;
type main$schematype = typeof _mainSchema;

export interface feedActivitySchema extends feedActivity$schematype {}
export interface mainSchema extends main$schematype {}

export const feedActivitySchema = _feedActivitySchema as feedActivitySchema;
export const mainSchema = _mainSchema as mainSchema;

export interface FeedActivity extends v.InferInput<typeof feedActivitySchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getFeed": mainSchema;
  }
}
