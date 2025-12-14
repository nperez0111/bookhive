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
const id = "buzz.bookhive.book";

export interface Record {
  $type: "buzz.bookhive.book";
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
  cover?: BlobRef;
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
  bookProgress?: BuzzBookhiveDefs.BookProgress;
  [k: string]: unknown;
}

const hashRecord = "main";

export function isRecord<V>(v: V) {
  return is$typed(v, id, hashRecord);
}

export function validateRecord<V>(v: V) {
  return validate<Record & V>(v, id, hashRecord, true);
}
