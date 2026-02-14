import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import * as ComAtprotoRepoStrongRef from "../../com/atproto/repo/strongRef.js";

const _abandonedSchema = /*#__PURE__*/ v.literal(
  "buzz.bookhive.defs#abandoned",
);
const _activitySchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#activity"),
  ),
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * The hive id of the book
   */
  hiveId: /*#__PURE__*/ v.string(),
  /**
   * The title of the book
   */
  title: /*#__PURE__*/ v.string(),
  type: /*#__PURE__*/ v.string<
    "finished" | "rated" | "review" | "started" | (string & {})
  >(),
  /**
   * The DID of the user who added the book
   */
  userDid: /*#__PURE__*/ v.string(),
  /**
   * The handle of the user who added the book
   */
  userHandle: /*#__PURE__*/ v.string(),
});
const _bookIdentifiersSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#bookIdentifiers"),
  ),
  /**
   * Goodreads book ID
   */
  goodreadsId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * BookHive's internal ID
   */
  hiveId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * 10-digit ISBN
   */
  isbn10: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * 13-digit ISBN
   */
  isbn13: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _bookProgressSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#bookProgress"),
  ),
  /**
   * Current chapter the user is on
   * @minimum 1
   */
  currentChapter: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(1),
    ]),
  ),
  /**
   * Current page the user is on
   * @minimum 1
   */
  currentPage: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(1),
    ]),
  ),
  /**
   * How far through the book the reader is (0-100)
   * @minimum 0
   * @maximum 100
   */
  percent: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(0, 100),
    ]),
  ),
  /**
   * Total number of chapters in the book
   * @minimum 1
   */
  totalChapters: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(1),
    ]),
  ),
  /**
   * Total number of pages in the book
   * @minimum 1
   */
  totalPages: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
      /*#__PURE__*/ v.integerRange(1),
    ]),
  ),
  /**
   * When the progress was last updated
   */
  updatedAt: /*#__PURE__*/ v.datetimeString(),
});
const _commentSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#comment"),
  ),
  get book() {
    return ComAtprotoRepoStrongRef.mainSchema;
  },
  /**
   * The content of the comment.
   * @maxLength 100000
   * @maxGraphemes 10000
   */
  comment: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
    /*#__PURE__*/ v.stringLength(0, 100000),
    /*#__PURE__*/ v.stringGraphemes(0, 10000),
  ]),
  /**
   * Client-declared timestamp when this comment was originally created.
   */
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * The DID of the user who made the comment
   */
  did: /*#__PURE__*/ v.string(),
  /**
   * The handle of the user who made the comment
   */
  handle: /*#__PURE__*/ v.string(),
  get parent() {
    return ComAtprotoRepoStrongRef.mainSchema;
  },
});
const _finishedSchema = /*#__PURE__*/ v.literal("buzz.bookhive.defs#finished");
const _ownedSchema = /*#__PURE__*/ v.literal("buzz.bookhive.defs#owned");
const _profileSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#profile"),
  ),
  avatar: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * @minimum 0
   */
  booksRead: /*#__PURE__*/ v.integer(),
  description: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  displayName: /*#__PURE__*/ v.string(),
  handle: /*#__PURE__*/ v.string(),
  /**
   * Whether the authed user is following this profile
   */
  isFollowing: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.boolean()),
  /**
   * @minimum 0
   */
  reviews: /*#__PURE__*/ v.integer(),
});
const _readingSchema = /*#__PURE__*/ v.literal("buzz.bookhive.defs#reading");
const _reviewSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#review"),
  ),
  /**
   * The date the review was created
   */
  createdAt: /*#__PURE__*/ v.datetimeString(),
  /**
   * The DID of the user who made the review
   */
  did: /*#__PURE__*/ v.string(),
  /**
   * The handle of the user who made the review
   */
  handle: /*#__PURE__*/ v.string(),
  /**
   * The review content
   */
  review: /*#__PURE__*/ v.string(),
  /**
   * The number of stars given to the book
   */
  stars: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
});
const _userBookSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.defs#userBook"),
  ),
  /**
   * The authors of the book (tab separated)
   * @minLength 1
   * @maxLength 2048
   */
  authors: /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [
    /*#__PURE__*/ v.stringLength(1, 2048),
  ]),
  /**
   * Progress tracking information for the book
   */
  get bookProgress() {
    return /*#__PURE__*/ v.optional(bookProgressSchema);
  },
  /**
   * Cover image of the book
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
   * The date the user finished reading the book
   */
  finishedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
  /**
   * The book's hive id, used to correlate user's books with the hive
   */
  hiveId: /*#__PURE__*/ v.string(),
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
   * Cover image of the book
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
  /**
   * The DID of the user who added the book
   */
  userDid: /*#__PURE__*/ v.string(),
  /**
   * The handle of the user who added the book
   */
  userHandle: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _wantToReadSchema = /*#__PURE__*/ v.literal(
  "buzz.bookhive.defs#wantToRead",
);

type abandoned$schematype = typeof _abandonedSchema;
type activity$schematype = typeof _activitySchema;
type bookIdentifiers$schematype = typeof _bookIdentifiersSchema;
type bookProgress$schematype = typeof _bookProgressSchema;
type comment$schematype = typeof _commentSchema;
type finished$schematype = typeof _finishedSchema;
type owned$schematype = typeof _ownedSchema;
type profile$schematype = typeof _profileSchema;
type reading$schematype = typeof _readingSchema;
type review$schematype = typeof _reviewSchema;
type userBook$schematype = typeof _userBookSchema;
type wantToRead$schematype = typeof _wantToReadSchema;

export interface abandonedSchema extends abandoned$schematype {}
export interface activitySchema extends activity$schematype {}
export interface bookIdentifiersSchema extends bookIdentifiers$schematype {}
export interface bookProgressSchema extends bookProgress$schematype {}
export interface commentSchema extends comment$schematype {}
export interface finishedSchema extends finished$schematype {}
export interface ownedSchema extends owned$schematype {}
export interface profileSchema extends profile$schematype {}
export interface readingSchema extends reading$schematype {}
export interface reviewSchema extends review$schematype {}
export interface userBookSchema extends userBook$schematype {}
export interface wantToReadSchema extends wantToRead$schematype {}

export const abandonedSchema = _abandonedSchema as abandonedSchema;
export const activitySchema = _activitySchema as activitySchema;
export const bookIdentifiersSchema =
  _bookIdentifiersSchema as bookIdentifiersSchema;
export const bookProgressSchema = _bookProgressSchema as bookProgressSchema;
export const commentSchema = _commentSchema as commentSchema;
export const finishedSchema = _finishedSchema as finishedSchema;
export const ownedSchema = _ownedSchema as ownedSchema;
export const profileSchema = _profileSchema as profileSchema;
export const readingSchema = _readingSchema as readingSchema;
export const reviewSchema = _reviewSchema as reviewSchema;
export const userBookSchema = _userBookSchema as userBookSchema;
export const wantToReadSchema = _wantToReadSchema as wantToReadSchema;

export type Abandoned = v.InferInput<typeof abandonedSchema>;
export interface Activity extends v.InferInput<typeof activitySchema> {}
export interface BookIdentifiers extends v.InferInput<
  typeof bookIdentifiersSchema
> {}
export interface BookProgress extends v.InferInput<typeof bookProgressSchema> {}
export interface Comment extends v.InferInput<typeof commentSchema> {}
export type Finished = v.InferInput<typeof finishedSchema>;
export type Owned = v.InferInput<typeof ownedSchema>;
export interface Profile extends v.InferInput<typeof profileSchema> {}
export type Reading = v.InferInput<typeof readingSchema>;
export interface Review extends v.InferInput<typeof reviewSchema> {}
export interface UserBook extends v.InferInput<typeof userBookSchema> {}
export type WantToRead = v.InferInput<typeof wantToReadSchema>;
