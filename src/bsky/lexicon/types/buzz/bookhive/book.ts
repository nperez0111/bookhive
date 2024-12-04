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
  [k: string]: unknown;
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, "$type") &&
    (v.$type === "buzz.bookhive.book#main" || v.$type === "buzz.bookhive.book")
  );
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.book#main", v);
}
