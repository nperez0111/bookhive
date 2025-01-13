/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from "@atproto/lexicon";
import { lexicons } from "../../../lexicons";
import { isObj, hasProp } from "../../../util";
import { CID } from "multiformats/cid";
import * as ComAtprotoRepoStrongRef from "../../com/atproto/repo/strongRef";

export interface Record {
  /** The content of the comment. */
  comment: string;
  /** Client-declared timestamp when this comment was originally created. */
  createdAt: string;
  parent: ComAtprotoRepoStrongRef.Main;
  book: ComAtprotoRepoStrongRef.Main;
  [k: string]: unknown;
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, "$type") &&
    (v.$type === "buzz.bookhive.buzz#main" || v.$type === "buzz.bookhive.buzz")
  );
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate("buzz.bookhive.buzz#main", v);
}
