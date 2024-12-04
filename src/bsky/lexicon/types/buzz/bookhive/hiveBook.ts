/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from "@atproto/lexicon";
import { lexicons } from "../../../lexicons";
import { isObj, hasProp } from "../../../util";
import { CID } from "multiformats/cid";

export interface Record {
  /** The title of the book */
  title: string;
  /** The authors of the book (tab separated) */
  authors: string;
  /** The book's hive id, used to correlate user's books with the hive */
  id: string;
  /** The source service name (e.g. Goodreads) */
  source?: string;
  /** URL to the book on the source service */
  sourceUrl?: string;
  /** ID of the book in the source service */
  sourceId?: string;
  /** URL to full-size cover image */
  cover?: string;
  /** URL to thumbnail image */
  thumbnail: string;
  /** Book description/summary */
  description?: string;
  /** Average rating (0-1000) */
  rating?: number;
  /** Number of ratings */
  ratingsCount?: number;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, "$type") &&
    (v.$type === "buzz.bookhive.hiveBook#main" ||
      v.$type === "buzz.bookhive.hiveBook")
  );
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.hiveBook#main", v);
}
