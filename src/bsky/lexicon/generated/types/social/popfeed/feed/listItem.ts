import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _bookProgressSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.popfeed.feed.listItem#bookProgress"),
  ),
  /**
   * Current chapter number (optional alternative to pages).
   */
  currentChapter: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Current page number (if applicable).
   */
  currentPage: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Optional explicit progress percentage (0–100).
   */
  percent: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Overall progress state.
   */
  status: /*#__PURE__*/ v.literalEnum(["completed", "in_progress", "paused"]),
  /**
   * Total chapters (if known).
   */
  totalChapters: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Total pages (if known).
   */
  totalPages: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * Last time progress was updated.
   */
  updatedAt: /*#__PURE__*/ v.datetimeString(),
});
const _identifiersSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.popfeed.feed.listItem#identifiers"),
  ),
  /**
   * Amazon Standard ID
   */
  asin: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Episode number for TV shows or series
   */
  episodeNumber: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * BookHive ID for fast local lookup
   */
  hiveId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * IGDB ID for games
   */
  igdbId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * IMDb ID
   */
  imdbId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * ISBN-10 for books
   */
  isbn10: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * ISBN-13 for books
   */
  isbn13: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * DEPRECATED - soon to be ignored
   */
  mbId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * MusicBrainz ID for specific releases (albums, EPs, tracks)
   */
  mbReleaseId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Other external ID
   */
  other: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * MusicBrainz ID for parent release (e.g., album for a track)
   */
  parentMbReleaseId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * Season number for TV shows or series
   */
  seasonNumber: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
  /**
   * TMDb ID for movies/TV shows
   */
  tmdbId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
  /**
   * TMDb ID for TV series
   */
  tmdbTvSeriesId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});
const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.tidString(),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("social.popfeed.feed.listItem"),
    /**
     * Timestamp when the creative work was added to the list.
     */
    addedAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * @accept image/*
     * @maxSize 4000000
     */
    backdrop: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.blob()),
    /**
     * Backdrop image URL for the creative work. Soon to be deprecated in favor of the 'backdrop' blob field
     */
    backdropUrl: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.genericUriString()),
    /**
     * Reading progress for books or book series (also supports audiobooks via time fields).
     */
    get bookProgress() {
      return /*#__PURE__*/ v.optional(bookProgressSchema);
    },
    /**
     * Timestamp when the user finished the creative work. Most relevant for books, TV shows, and video games.
     */
    completedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
    /**
     * The type of creative work this item represents.
     */
    creativeWorkType: /*#__PURE__*/ v.literalEnum([
      "album",
      "album",
      "book",
      "book_series",
      "ep",
      "episode",
      "movie",
      "track",
      "tv_episode",
      "tv_season",
      "tv_show",
      "video_game",
    ]),
    /**
     * Optional description or commentary for the list item.
     * @maxLength 5000
     */
    description: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 5000)]),
    ),
    genres: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.array(
        /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 50)]),
      ),
    ),
    /**
     * External identifiers for the creative work.
     */
    get identifiers() {
      return identifiersSchema;
    },
    /**
     * The type of list, e.g., 'watchlist', 'favorites', 'to-read', etc.
     * @maxLength 50
     */
    listType: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 50)]),
    ),
    /**
     * URI of the list where the item is stored.
     */
    listUri: /*#__PURE__*/ v.genericUriString(),
    /**
     * Main actor, director, author, or artist of the creative work.
     * @maxLength 1000
     */
    mainCredit: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 1000)]),
    ),
    /**
     * The role of the main credit.
     */
    mainCreditRole: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.literalEnum([
        "artist",
        "author",
        "creator",
        "developer",
        "director",
        "lead_actor",
        "network",
        "performer",
        "publisher",
        "showrunner",
        "studio",
      ]),
    ),
    /**
     * DEPRECATED
     * @deprecated
     */
    position: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.integer()),
    /**
     * @accept image/*
     * @maxSize 2000000
     */
    poster: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.blob()),
    /**
     * Poster or cover image URL for the creative work. Soon to be deprecated in favor of the 'poster' blob field
     */
    posterUrl: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.genericUriString()),
    /**
     * Release date of the creative work.
     */
    releaseDate: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
    /**
     * Timestamp when the user started the creative work. Most relevant for books, TV shows, and video games.
     */
    startedAt: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.datetimeString()),
    status: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.string<
        "#abandoned" | "#backlog" | "#finished" | "#in_progress" | (string & {})
      >(),
    ),
    /**
     * Title of the creative work.
     * @maxLength 1000
     */
    title: /*#__PURE__*/ v.optional(
      /*#__PURE__*/ v.constrain(/*#__PURE__*/ v.string(), [/*#__PURE__*/ v.stringLength(0, 1000)]),
    ),
    /**
     * For TV shows, the episodes the user has watched.
     */
    get watchedEpisodes() {
      return /*#__PURE__*/ v.optional(/*#__PURE__*/ v.array(watchedEpisodeSchema));
    },
  }),
);
const _watchedEpisodeSchema = /*#__PURE__*/ v.object({
  $type: /*#__PURE__*/ v.optional(
    /*#__PURE__*/ v.literal("social.popfeed.feed.listItem#watchedEpisode"),
  ),
  episodeNumber: /*#__PURE__*/ v.integer(),
  seasonNumber: /*#__PURE__*/ v.integer(),
  tmdbId: /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
});

type bookProgress$schematype = typeof _bookProgressSchema;
type identifiers$schematype = typeof _identifiersSchema;
type main$schematype = typeof _mainSchema;
type watchedEpisode$schematype = typeof _watchedEpisodeSchema;

export interface bookProgressSchema extends bookProgress$schematype {}
export interface identifiersSchema extends identifiers$schematype {}
export interface mainSchema extends main$schematype {}
export interface watchedEpisodeSchema extends watchedEpisode$schematype {}

export const bookProgressSchema = _bookProgressSchema as bookProgressSchema;
export const identifiersSchema = _identifiersSchema as identifiersSchema;
export const mainSchema = _mainSchema as mainSchema;
export const watchedEpisodeSchema = _watchedEpisodeSchema as watchedEpisodeSchema;

export interface BookProgress extends v.InferInput<typeof bookProgressSchema> {}
export interface Identifiers extends v.InferInput<typeof identifiersSchema> {}
export interface Main extends v.InferInput<typeof mainSchema> {}
export interface WatchedEpisode extends v.InferInput<typeof watchedEpisodeSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "social.popfeed.feed.listItem": mainSchema;
  }
}
