/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from "@atproto/lexicon";
import { lexicons } from "../../../lexicons";
import { isObj, hasProp } from "../../../util";
import { CID } from "multiformats/cid";
import * as ComAtprotoRepoStrongRef from "../../com/atproto/repo/strongRef";

/** User has finished reading the book */
export const FINISHED = "buzz.bookhive.defs#finished";
/** User is currently reading the book */
export const READING = "buzz.bookhive.defs#reading";
/** User wants to read the book */
export const WANTTOREAD = "buzz.bookhive.defs#wantToRead";
/** User has abandoned the book */
export const ABANDONED = "buzz.bookhive.defs#abandoned";
/** User owns the book */
export const OWNED = "buzz.bookhive.defs#owned";

export interface Review {
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
  [k: string]: unknown;
}

export function isReview(v: unknown): v is Review {
  return (
    isObj(v) && hasProp(v, "$type") && v.$type === "buzz.bookhive.defs#review"
  );
}

export function validateReview(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.defs#review", v);
}

export interface Comment {
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
  [k: string]: unknown;
}

export function isComment(v: unknown): v is Comment {
  return (
    isObj(v) && hasProp(v, "$type") && v.$type === "buzz.bookhive.defs#comment"
  );
}

export function validateComment(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.defs#comment", v);
}

export interface Profile {
  displayName: string;
  handle: string;
  avatar?: string;
  description?: string;
  [k: string]: unknown;
}

export function isProfile(v: unknown): v is Profile {
  return (
    isObj(v) && hasProp(v, "$type") && v.$type === "buzz.bookhive.defs#profile"
  );
}

export function validateProfile(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.defs#profile", v);
}

export interface UserBook {
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
  [k: string]: unknown;
}

export function isUserBook(v: unknown): v is UserBook {
  return (
    isObj(v) && hasProp(v, "$type") && v.$type === "buzz.bookhive.defs#userBook"
  );
}

export function validateUserBook(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.defs#userBook", v);
}
