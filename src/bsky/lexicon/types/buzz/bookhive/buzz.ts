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
const id = "buzz.bookhive.buzz";

export interface Record {
  $type: "buzz.bookhive.buzz";
  /** The content of the comment. */
  comment: string;
  /** Client-declared timestamp when this comment was originally created. */
  createdAt: string;
  parent: ComAtprotoRepoStrongRef.Main;
  book: ComAtprotoRepoStrongRef.Main;
  [k: string]: unknown;
}

const hashRecord = "main";

export function isRecord<V>(v: V) {
  return is$typed(v, id, hashRecord);
}

export function validateRecord<V>(v: V) {
  return validate<Record & V>(v, id, hashRecord, true);
}
