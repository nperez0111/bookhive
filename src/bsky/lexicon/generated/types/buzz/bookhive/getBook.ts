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
     * The book ISBN-10 identifier
     */
    isbn10: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
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
        return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(BuzzBookhiveDefs.activitySchema));
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
      cover: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.blob(), [
          /*#__PURE__*/ v.blobSize(1000000),
          /*#__PURE__*/ v.blobAccept(["image/png", "image/jpeg"]),
        ]),
      ),
      createdAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
      /**
       * The date the user finished reading the book
       */
      finishedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
      /**
       * Whether the user owns this book
       */
      owned: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
      /**
       * History of prior reads of this book by the user (most recent first)
       * @maxLength 50
       */
      get previousReads() {
        return /*#__PURE__*/ v.optional(
          /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.array(BuzzBookhiveDefs.previousReadSchema), [
            /*#__PURE__*/ v.arrayLength(0, 50),
          ]),
        );
      },
      /**
       * The authenticated viewer's latest 20 progress entries for this book, newest first. Omitted when signed out; unknown page/count/percent values are omitted.
       * @maxLength 20
       */
      get progressHistory() {
        return /*#__PURE__*/ v.optional(
          /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.array(progressHistoryEntrySchema), [
            /*#__PURE__*/ v.arrayLength(0, 20),
          ]),
        );
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
       * Reviews of the book
       */
      get reviews() {
        return /*#__PURE__*/ v.array(BuzzBookhiveDefs.reviewSchema);
      },
      /**
       * Public catalogue shelves containing this book, including the viewer's and other readers' shelves. Omitted when signed out. Never includes private ebook shelves.
       */
      get shelves() {
        return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(shelfMembershipSchema));
      },
      /**
       * Number of stars given to the book (1-10) which will be mapped to 1-5 stars
       * @minimum 1
       * @maximum 10
       */
      stars: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [/*#__PURE__*/ v.integerRange(1, 10)]),
      ),
      /**
       * The date the user started reading the book
       */
      startedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
      status: /*#__PURE__*/ v.optional(
        /*#__PURE__*/ v.string<
          | "buzz.bookhive.defs#abandoned"
          | "buzz.bookhive.defs#finished"
          | "buzz.bookhive.defs#reading"
          | "buzz.bookhive.defs#wantToRead"
          | (string & {})
        >(),
      ),
    }),
  },
});
const _progressHistoryEntrySchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getBook#progressHistoryEntry"),
  ),
  createdAt: /*#__PURE__*/ v.datetimeString(),
  currentPage: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  percent: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  totalPages: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
});
const _shelfMembershipSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("buzz.bookhive.getBook#shelfMembership")),
  /**
   * AT-URI of the shelf's book-list item
   */
  itemUri: /*#__PURE__*/ v.string(),
  name: /*#__PURE__*/ v.string(),
  /**
   * AT-URI of the public catalogue shelf
   */
  uri: /*#__PURE__*/ v.string(),
  /**
   * DID of the shelf owner
   */
  userDid: /*#__PURE__*/ v.string(),
});
type main$schematype = typeof _mainSchema;
type progressHistoryEntry$schematype = typeof _progressHistoryEntrySchema;
type shelfMembership$schematype = typeof _shelfMembershipSchema;

export interface mainSchema extends main$schematype {}

export interface progressHistoryEntrySchema extends progressHistoryEntry$schematype {}

export interface shelfMembershipSchema extends shelfMembership$schematype {}
export const mainSchema = _mainSchema as mainSchema;
export const progressHistoryEntrySchema = _progressHistoryEntrySchema as progressHistoryEntrySchema;
export const shelfMembershipSchema = _shelfMembershipSchema as shelfMembershipSchema;

export interface ProgressHistoryEntry extends v.InferInput<typeof progressHistoryEntrySchema> {}

export interface ShelfMembership extends v.InferInput<typeof shelfMembershipSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}

export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}
declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getBook": mainSchema;
  }
}
