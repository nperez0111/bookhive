import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveDefs from "./defs.js";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("buzz.bookhive.book"),
    /**
     * The authors of the book (tab separated)
     * @minLength 1
     * @maxLength 2048
     */
    authors: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 2048),
    ]),
    /**
     * Progress tracking details for the book
     */
    get bookProgress() {
      return /*#__PURE__*/ v.optional(BuzzBookhiveDefs.bookProgressSchema);
    },
    /**
     * Cover image of the book
     * @accept image/png, image/jpeg
     * @maxSize 1000000
     */
    cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.blob()),
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * The date the user finished reading the book
     */
    finishedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
    /**
     * The book's hive id, used to correlate user's books with the hive
     */
    hiveId: /*#__PURE__*/ v.string(),
    /**
     * External identifiers for the book
     */
    get identifiers() {
      return /*#__PURE__*/ v.optional(BuzzBookhiveDefs.bookIdentifiersSchema);
    },
    /**
     * The book's review
     * @maxGraphemes 15000
     */
    review: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
        /*#__PURE__*/ v.stringGraphemes(0, 15000),
      ]),
    ),
    /**
     * Number of stars given to the book (1-10) which will be mapped to 1-5 stars
     * @minimum 1
     * @maximum 10
     */
    stars: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(1, 10),
      ]),
    ),
    /**
     * The date the user started reading the book
     */
    startedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
    status: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.string<
        | "buzz.bookhive.defs#abandoned"
        | "buzz.bookhive.defs#finished"
        | "buzz.bookhive.defs#owned"
        | "buzz.bookhive.defs#reading"
        | "buzz.bookhive.defs#wantToRead"
        | (string & {})
      >(),
    ),
    /**
     * The title of the book
     * @minLength 1
     * @maxLength 512
     */
    title: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
      /*#__PURE__*/ v.stringLength(1, 512),
    ]),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "buzz.bookhive.book": mainSchema;
  }
}
