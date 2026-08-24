import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _feedActivitySchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getFeed#feedActivity")),
  authors: /*#__PURE__*/ v.string(),
  cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  createdAt: /*#__PURE__*/ v.datetimeString(),
  hiveId: /*#__PURE__*/ v.string(),
  /**
   * When this activity happened, and the feed's sort key. Prefer this over createdAt for display: createdAt is frozen at record creation, so it does not move when a book is finished or reviewed.
   */
  indexedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
  review: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * @minimum 1
   * @maximum 10
   */
  stars: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1, 10)]),
  ),
  status: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  thumbnail: /*#__PURE__*/ v.string(),
  title: /*#__PURE__*/ v.string(),
  userAvatar: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  userDid: /*#__PURE__*/ v.string(),
  userHandle: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _feedGroupSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getFeed#feedGroup")),
  /**
   * For a burst, a preview of up to 8 activities; total carries the full count. The top-level activities array holds the complete expansion.
   */
  get activities() {
    return /*#__PURE__*/ v.array(feedActivitySchema);
  },
  kind: /*#__PURE__*/ v.string<"burst" | "single" | (string & {})>(),
  /**
   * Number of activities in a burst. Absent or 1 for a single.
   */
  total: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * True when the burst was force-closed at a page boundary, so total is a floor rather than an exact count.
   */
  truncated: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
  /**
   * Display verb for the row, e.g. "finished", "wants to read", or "logged" when a burst spans several statuses.
   */
  verb: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getFeed", {
  params: /*#__PURE__*/ v.object({
    /**
     * Collapse import/re-sync bursts into grouped rows. Pass false for a flat activity list.
     * @default true
     */
    collapse: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean(), true),
    /**
     * Opaque pagination cursor from a previous response. Preferred over page.
     * @maxLength 512
     */
    cursor: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 512)]),
    ),
    /**
     * @minimum 1
     * @maximum 50
     * @default 25
     */
    limit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1, 50)]),
      25,
    ),
    /**
     * Deprecated: use cursor. Page 1 answers normally; a later page without a cursor returns an empty page with hasMore false so old clients stop paging.
     * @deprecated
     * @minimum 1
     * @default 1
     */
    page: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1)]),
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
      /**
       * Flat activity list, newest first. Bursts are expanded here so existing clients keep working; read groups for the collapsed view.
       */
      get activities() {
        return /*#__PURE__*/ v.array(feedActivitySchema);
      },
      /**
       * Pass as cursor to fetch the next page. Absent when the feed is exhausted.
       */
      cursor: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
      get groups() {
        return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(feedGroupSchema));
      },
      hasMore: /*#__PURE__*/ v.boolean(),
      page: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    }),
  },
});
type feedActivity$schematype = typeof _feedActivitySchema;
type feedGroup$schematype = typeof _feedGroupSchema;
type main$schematype = typeof _mainSchema;

export interface feedActivitySchema extends feedActivity$schematype {}

export interface feedGroupSchema extends feedGroup$schematype {}

export interface mainSchema extends main$schematype {}
export const feedActivitySchema = _feedActivitySchema as feedActivitySchema;
export const feedGroupSchema = _feedGroupSchema as feedGroupSchema;
export const mainSchema = _mainSchema as mainSchema;

export interface FeedActivity extends v.InferInput<typeof feedActivitySchema> {}

export interface FeedGroup extends v.InferInput<typeof feedGroupSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getFeed": mainSchema;
  }
}
