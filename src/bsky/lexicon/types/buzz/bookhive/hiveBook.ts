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
import type * as BuzzBookhiveDefs from "./defs.js";

const is$typed = _is$typed,
  validate = _validate;
const id = "buzz.bookhive.hiveBook";

export interface Record {
  $type: "buzz.bookhive.hiveBook";
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
  identifiers?: BuzzBookhiveDefs.BookIdentifiers;
  [k: string]: unknown;
}

const hashRecord = "main";

export function isRecord<V>(v: V) {
  return is$typed(v, id, hashRecord);
}

export function validateRecord<V>(v: V) {
  return validate<Record & V>(v, id, hashRecord, true);
}
