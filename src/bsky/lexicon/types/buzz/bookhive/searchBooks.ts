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

const is$typed = _is$typed,
  validate = _validate;
const id = "buzz.bookhive.searchBooks";

export interface QueryParams {
  /** Search query string. Will be matched against title and authors fields. */
  q: string;
  limit: number;
  /** Offset for pagination into the result set */
  offset?: number;
  /** The ID of the book within the hive. */
  id?: string;
}

export type InputSchema = undefined;

export interface OutputSchema {
  /** The next offset to use for pagination (result of limit + offset) */
  offset?: number;
  books: BuzzBookhiveHiveBook.Record[];
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
