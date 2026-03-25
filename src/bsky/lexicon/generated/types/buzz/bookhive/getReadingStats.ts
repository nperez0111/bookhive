import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _bookSummarySchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getReadingStats#bookSummary"),
  ),
  authors: /*#__PURE__*/ v.string(),
  cover: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  hiveId: /*#__PURE__*/ v.string(),
  pageCount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  rating: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  thumbnail: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  title: /*#__PURE__*/ v.string(),
});
const _genreStatSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getReadingStats#genreStat"),
  ),
  /**
   * @minimum 0
   */
  count: /*#__PURE__*/ v.integer(),
  genre: /*#__PURE__*/ v.string(),
});
const _mainSchema = /*#__PURE__*/ v.query("buzz.bookhive.getReadingStats", {
  params: /*#__PURE__*/ v.object({
    /**
     * The user handle or DID
     */
    handle: /*#__PURE__*/ v.string(),
    /**
     * The year to fetch stats for. Defaults to current year.
     * @minimum 2000
     * @maximum 2100
     */
    year: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.integer(), [
        /*#__PURE__*/ v.integerRange(2000, 2100),
      ]),
    ),
  }),
  output: {
    type: "lex",
    schema: /*#__PURE__*/ v.object({
      availableYears: /*#__PURE__*/ v.array(/*#__PURE__*/ v.integer()),
      get stats() {
        return readingStatsSchema;
      },
      year: /*#__PURE__*/ v.integer(),
    }),
  },
});
const _ratingDistributionSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getReadingStats#ratingDistribution"),
  ),
  /**
   * @minimum 0
   */
  five: /*#__PURE__*/ v.integer(),
  /**
   * @minimum 0
   */
  four: /*#__PURE__*/ v.integer(),
  /**
   * @minimum 0
   */
  one: /*#__PURE__*/ v.integer(),
  /**
   * @minimum 0
   */
  three: /*#__PURE__*/ v.integer(),
  /**
   * @minimum 0
   */
  two: /*#__PURE__*/ v.integer(),
});
const _readingStatsSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("buzz.bookhive.getReadingStats#readingStats"),
  ),
  averagePageCount: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Average rating * 10 (e.g. 42 = 4.2 stars)
   */
  averageRating: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * @minimum 0
   */
  booksCount: /*#__PURE__*/ v.integer(),
  get firstBookOfYear() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  get lastBookOfYear() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  get leastPopularBook() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  get longestBook() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  get mostPopularBook() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  /**
   * @minimum 0
   */
  pagesRead: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  get ratingDistribution() {
    return ratingDistributionSchema;
  },
  get shortestBook() {
    return /*#__PURE__*/ v.optional(bookSummarySchema);
  },
  get topGenres() {
    return /*#__PURE__*/ v.array(genreStatSchema);
  },
});

type bookSummary$schematype = typeof _bookSummarySchema;
type genreStat$schematype = typeof _genreStatSchema;
type main$schematype = typeof _mainSchema;
type ratingDistribution$schematype = typeof _ratingDistributionSchema;
type readingStats$schematype = typeof _readingStatsSchema;

export interface bookSummarySchema extends bookSummary$schematype {}
export interface genreStatSchema extends genreStat$schematype {}
export interface mainSchema extends main$schematype {}
export interface ratingDistributionSchema extends ratingDistribution$schematype {}
export interface readingStatsSchema extends readingStats$schematype {}

export const bookSummarySchema = _bookSummarySchema as bookSummarySchema;
export const genreStatSchema = _genreStatSchema as genreStatSchema;
export const mainSchema = _mainSchema as mainSchema;
export const ratingDistributionSchema = _ratingDistributionSchema as ratingDistributionSchema;
export const readingStatsSchema = _readingStatsSchema as readingStatsSchema;

export interface BookSummary extends v.InferInput<typeof bookSummarySchema> {}
export interface GenreStat extends v.InferInput<typeof genreStatSchema> {}
export interface RatingDistribution extends v.InferInput<typeof ratingDistributionSchema> {}
export interface ReadingStats extends v.InferInput<typeof readingStatsSchema> {}

export interface $params extends v.InferInput<mainSchema["params"]> {}
export interface $output extends v.InferXRPCBodyInput<mainSchema["output"]> {}

declare module "@atcute/lexicons/ambient" {
  interface XRPCQueries {
    "buzz.bookhive.getReadingStats": mainSchema;
  }
}
