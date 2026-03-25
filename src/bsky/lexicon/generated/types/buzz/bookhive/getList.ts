import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _listItemViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getList#listItemView")),
  addedAt: /*#__PURE__*/ v.datetimeString(),
  authors: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  description: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  hiveId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  position: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  rating: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  thumbnail: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  title: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  uri: /*#__PURE__*/ v.string(),
});
const _listViewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getList#listView")),
  cid: /*#__PURE__*/ v.string(),
  createdAt: /*#__PURE__*/ v.datetimeString(),
  description: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  itemCount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  name: /*#__PURE__*/ v.string(),
  ordered: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
  tags: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(/*#__PURE__*/ v.string())),
  uri: /*#__PURE__*/ v.string(),
  userDid: /*#__PURE__*/ v.string(),
  userHandle: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getList", {
  params: /*#__PURE__*/ v.object({
    /**
     * AT-URI of the list
     */
    uri: /*#__PURE__*/ v.string(),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      get items() {
        return /*#__PURE__*/ v.array(listItemViewSchema);
      },
      get list() {
        return listViewSchema;
      },
    }),
  },
});

type listItemView$schematype = typeof _listItemViewSchema;
type listView$schematype = typeof _listViewSchema;
type main$schematype = typeof _mainSchema;

export interface listItemViewSchema extends listItemView$schematype {}
export interface listViewSchema extends listView$schematype {}
export interface mainSchema extends main$schematype {}

export const listItemViewSchema = _listItemViewSchema as listItemViewSchema;
export const listViewSchema = _listViewSchema as listViewSchema;
export const mainSchema = _mainSchema as mainSchema;

export interface ListItemView extends v.InferInput<typeof listItemViewSchema> {}
export interface ListView extends v.InferInput<typeof listViewSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getList": mainSchema;
  }
}
