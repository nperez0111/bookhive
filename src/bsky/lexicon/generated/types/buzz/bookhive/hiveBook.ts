import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveDefs from "./defs.js";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("buzz.bookhive.hiveBook"),
    /**
     * The authors of the book (tab separated)
     * @minLength 1
     * @maxLength 512
     */
    authors: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 512),
    ]),
    /**
     * URL to full-size cover image
     */
    cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * Book description/summary
     * @maxLength 5000
     */
    description: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringLength(0, 5000),
      ]),
    ),
    /**
     * The book's hive id, used to correlate user's books with the hive
     */
    id: /*#__PURE__*/ v.string(),
    /**
     * External identifiers for the book
     */
    get identifiers() {
      return /*#__PURE__*/ v.optional(BuzzBookhiveDefs.bookIdentifiersSchema);
    },
    /**
     * Average rating (0-1000)
     * @minimum 0
     * @maximum 1000
     */
    rating: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(0, 1000),
      ]),
    ),
    /**
     * Number of ratings
     */
    ratingsCount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * The source service name (e.g. Goodreads)
     */
    source: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * ID of the book in the source service
     */
    sourceId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * URL to the book on the source service
     */
    sourceUrl: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * URL to thumbnail image
     */
    thumbnail: /*#__PURE__*/ v.string(),
    /**
     * The title of the book
     * @minLength 1
     * @maxLength 512
     */
    title: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 512),
    ]),
    updatedAt: /*#__PURE__*/ v.datetimeString(),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "buzz.bookhive.hiveBook": mainSchema;
  }
}
