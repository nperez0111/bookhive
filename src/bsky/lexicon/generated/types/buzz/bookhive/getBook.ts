import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";
import * as BuzzBookhiveDefs from "./defs.js";
import * as BuzzBookhiveHiveBook from "./hiveBook.js";

const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getBook", {
  params: /*#__PURE__*/ v.object({
    /**
     * The Goodreads identifier for the book
     */
    goodreadsId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * The book's hive ID
     */
    id: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * The book ISBN identifier
     */
    isbn: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
    /**
     * The book ISBN-13 identifier
     */
    isbn13: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      /**
       * Other users' activity on the book
       */
      get activity() {
        return /*#__PURE__*/ v.optional(
          /*#__PURE__*/ v.array(BuzzBookhiveDefs.activitySchema),
        );
      },
      /**
       * The hive book's info
       */
      get book() {
        return BuzzBookhiveHiveBook.mainSchema;
      },
      /**
       * Reading progress for the user
       */
      get bookProgress() {
        return /*#__PURE__*/ v.optional(BuzzBookhiveDefs.bookProgressSchema);
      },
      /**
       * Comments on the book
       */
      get comments() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.commentSchema);
      },
      /**
       * Cover image of the book
       * @accept image/png, image/jpeg
       * @maxSize 1000000
       */
      cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.blob()),
      createdAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
      /**
       * The date the user finished reading the book
       */
      finishedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
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
       * Reviews of the book
       */
      get reviews() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.reviewSchema);
      },
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
    "buzz.bookhive.getBook": mainSchema;
  }
}
