/**
 * GENERATED CODE - DO NOT MODIFY
 */
import express from "express";
import { ValidationResult, BlobRef } from "@atproto/lexicon";
import { lexicons } from "../../../lexicons";
import { isObj, hasProp } from "../../../util";
import { CID } from "multiformats/cid";
import { HandlerAuth, HandlerPipeThrough } from "@atproto/xrpc-server";
import * as BuzzBookhiveHiveBook from "./hiveBook";

export interface QueryParams {
  /** Search query string. Will be matched against title and author fields. */
  q: string;
  limit: number;
  /** Offset for pagination into the result set */
  offset?: number;
}

export type InputSchema = undefined;

export interface OutputSchema {
  /** The next offset to use for pagination (result of limit + offset) */
  offset?: number;
  books: BuzzBookhiveHiveBook.Record[];
  [k: string]: unknown;
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
};
export type Handler<HA extends HandlerAuth = never> = (
  ctx: HandlerReqCtx<HA>,
) => Promise<HandlerOutput> | HandlerOutput;
