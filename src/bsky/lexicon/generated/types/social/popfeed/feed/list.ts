import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.popfeed.feed.list"),
    /**
     * The timestamp when the list was created.
     */
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Optional description of the list.
     * @maxLength 500
     */
    description: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 500)]),
    ),
    /**
     * An array of item uris in the order they appear in the list. Stored separately from the items themselves to allow for efficient reordering without needing to update each item record.
     */
    itemOrder: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(/*#__PURE__*/ v.genericUriString())),
    /**
     * The type of list, e.g., 'watchlist', 'favorites', 'to-read', etc.
     * @maxLength 50
     */
    listType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 50)]),
    ),
    /**
     * The name of the list.
     * @maxLength 100
     */
    name: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(0, 100),
    ]),
    /**
     * Indicates whether the list is ordered or unordered.
     */
    ordered: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
    /**
     * Optional array of tags for categorizing or describing the list.
     */
    tags: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.array(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 50)]),
      ),
    ),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.popfeed.feed.list": mainSchema;
  }
}
