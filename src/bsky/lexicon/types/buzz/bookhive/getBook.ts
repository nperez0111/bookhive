/**
 * GENERATED CODE - DO NOT MODIFY
 */
import express from "express";
import { type ValidationResult, BlobRef } from "@atproto/lexicon";
import { CID } from "multiformats/cid";
import { validate as _validate } from "../../../lexicons";
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from "../../../util";
import { HandlerAuth, HandlerPipeThrough } from "@atproto/xrpc-server";
import type * as BuzzBookhiveHiveBook from "./hiveBook.js";
import type * as BuzzBookhiveDefs from "./defs.js";

const is$typed = _is$typed,
  validate = _validate;
const id = "buzz.bookhive.getBook";

export interface QueryParams {
  /** The book's hive ID */
  id: string;
}

export type InputSchema = undefined;

export interface OutputSchema {
  createdAt?: string;
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
  book: BuzzBookhiveHiveBook.Record;
  /** Reviews of the book */
  reviews: BuzzBookhiveDefs.Review[];
  /** Comments on the book */
  comments: BuzzBookhiveDefs.Comment[];
  /** Other users' activity on the book */
  activity?: BuzzBookhiveDefs.Activity[];
}

export type HandlerInput = undefined;

export interface HandlerSuccess {
  encoding: "application/json";
  body: OutputSchema;
  headers?: { [key: string]: string };
}

export interface HandlerError {
  status: number;
  message?: string;
}

export type HandlerOutput = HandlerError | HandlerSuccess | HandlerPipeThrough;
export type HandlerReqCtx<HA extends HandlerAuth = never> = {
  auth: HA;
  params: QueryParams;
  input: HandlerInput;
  req: express.Request;
  res: express.Response;
  resetRouteRateLimits: () => Promise<void>;
};
export type Handler<HA extends HandlerAuth = never> = (
  ctx: HandlerReqCtx<HA>,
) => Promise<HandlerOutput> | HandlerOutput;
