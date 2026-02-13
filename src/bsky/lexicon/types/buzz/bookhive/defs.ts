/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from "@atproto/lexicon";
import { CID } from "multiformats/cid";
import { validate as _validate } from "../../../lexicons";
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from "../../../util";
import type * as ComAtprotoRepoStrongRef from "../../com/atproto/repo/strongRef.js";

const is$typed = _is$typed,
  validate = _validate;
const id = "buzz.bookhive.defs";
/** User has finished reading the book */
export const FINISHED = `${id}#finished`;
/** User is currently reading the book */
export const READING = `${id}#reading`;
/** User wants to read the book */
export const WANTTOREAD = `${id}#wantToRead`;
/** User has abandoned the book */
export const ABANDONED = `${id}#abandoned`;
/** User owns the book */
export const OWNED = `${id}#owned`;

export interface Review {
  $type?: "buzz.bookhive.defs#review";
  /** The review content */
  review: string;
  /** The date the review was created */
  createdAt: string;
  /** The number of stars given to the book */
  stars?: number;
  /** The DID of the user who made the review */
  did: string;
  /** The handle of the user who made the review */
  handle: string;
}

const hashReview = "review";

export function isReview<V>(v: V) {
  return is$typed(v, id, hashReview);
}

export function validateReview<V>(v: V) {
  return validate<Review & V>(v, id, hashReview);
}

export interface Comment {
  $type?: "buzz.bookhive.defs#comment";
  /** The content of the comment. */
  comment: string;
  /** Client-declared timestamp when this comment was originally created. */
  createdAt: string;
  parent: ComAtprotoRepoStrongRef.Main;
  book: ComAtprotoRepoStrongRef.Main;
  /** The DID of the user who made the comment */
  did: string;
  /** The handle of the user who made the comment */
  handle: string;
}

const hashComment = "comment";

export function isComment<V>(v: V) {
  return is$typed(v, id, hashComment);
}

export function validateComment<V>(v: V) {
  return validate<Comment & V>(v, id, hashComment);
}

export interface Profile {
  $type?: "buzz.bookhive.defs#profile";
  displayName: string;
  handle: string;
  avatar?: string;
  description?: string;
  booksRead: number;
  reviews: number;
  /** Whether the authed user is following this profile */
  isFollowing?: boolean;
}

const hashProfile = "profile";

export function isProfile<V>(v: V) {
  return is$typed(v, id, hashProfile);
}

export function validateProfile<V>(v: V) {
  return validate<Profile & V>(v, id, hashProfile);
}

export interface Activity {
  $type?: "buzz.bookhive.defs#activity";
  type: "review" | "rated" | "started" | "finished" | (string & {});
  createdAt: string;
  /** The hive id of the book */
  hiveId: string;
  /** The title of the book */
  title: string;
  /** The DID of the user who added the book */
  userDid: string;
  /** The handle of the user who added the book */
  userHandle: string;
}

const hashActivity = "activity";

export function isActivity<V>(v: V) {
  return is$typed(v, id, hashActivity);
}

export function validateActivity<V>(v: V) {
  return validate<Activity & V>(v, id, hashActivity);
}

export interface UserBook {
  $type?: "buzz.bookhive.defs#userBook";
  /** The DID of the user who added the book */
  userDid: string;
  /** The handle of the user who added the book */
  userHandle?: string;
  /** The title of the book */
  title: string;
  /** The authors of the book (tab separated) */
  authors: string;
  /** The book's hive id, used to correlate user's books with the hive */
  hiveId: string;
  createdAt: string;
  /** The date the user started reading the book */
  startedAt?: string;
  /** The date the user finished reading the book */
  finishedAt?: string;
  /** Cover image of the book */
  cover?: string;
  /** Cover image of the book */
  thumbnail: string;
  /** Book description/summary */
  description?: string;
  /** Average rating (0-1000) */
  rating?: number;
  status?:
    | "buzz.bookhive.defs#finished"
    | "buzz.bookhive.defs#reading"
    | "buzz.bookhive.defs#wantToRead"
    | "buzz.bookhive.defs#abandoned"
    | "buzz.bookhive.defs#owned"
    | (string & {});
  /** Number of stars given to the book (1-10) which will be mapped to 1-5 stars */
  stars?: number;
  /** The book's review */
  review?: string;
  bookProgress?: BookProgress;
}

const hashUserBook = "userBook";

export function isUserBook<V>(v: V) {
  return is$typed(v, id, hashUserBook);
}

export function validateUserBook<V>(v: V) {
  return validate<UserBook & V>(v, id, hashUserBook);
}

/** Reading progress tracking data */
export interface BookProgress {
  $type?: "buzz.bookhive.defs#bookProgress";
  /** How far through the book the reader is (0-100) */
  percent?: number;
  /** Total number of pages in the book */
  totalPages?: number;
  /** Current page the user is on */
  currentPage?: number;
  /** Total number of chapters in the book */
  totalChapters?: number;
  /** Current chapter the user is on */
  currentChapter?: number;
  /** When the progress was last updated */
  updatedAt: string;
}

const hashBookProgress = "bookProgress";

export function isBookProgress<V>(v: V) {
  return is$typed(v, id, hashBookProgress);
}

export function validateBookProgress<V>(v: V) {
  return validate<BookProgress & V>(v, id, hashBookProgress);
}

export interface BookIdMap {
  $type?: "buzz.bookhive.defs#bookIdMap";
  /** The hive ID for the book */
  hiveId: string;
  /** The book ISBN identifier */
  isbn?: string;
  /** The book ISBN-13 identifier */
  isbn13?: string;
  /** The Goodreads identifier for the book */
  goodreadsId?: string;
}

const hashBookIdMap = "bookIdMap";

export function isBookIdMap<V>(v: V) {
  return is$typed(v, id, hashBookIdMap);
}

export function validateBookIdMap<V>(v: V) {
  return validate<BookIdMap & V>(v, id, hashBookIdMap);
}
