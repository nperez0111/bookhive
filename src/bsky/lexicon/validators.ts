/**
 * Validation helpers for lexicon records using @atcute/lexicons.
 * Compatible with existing { success, value, error } shape.
 */
import { safeParse } from "@atcute/lexicons";
import * as BookSchema from "./generated/types/buzz/bookhive/book.js";
import * as BuzzSchema from "./generated/types/buzz/bookhive/buzz.js";
import * as StrongRefSchema from "./generated/types/com/atproto/repo/strongRef.js";

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; error: Error };

type AtcuteErr = { ok: false; message: string; throw(): never };

function fromAtcuteResult<T>(
  r: { ok: true; value: T } | AtcuteErr,
): ValidationResult<T> {
  if (r.ok) {
    return { success: true, value: r.value };
  }
  try {
    (r as AtcuteErr).throw();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
  return { success: false, error: new Error((r as AtcuteErr).message) };
}

export function validateBookRecord(
  v: unknown,
): ValidationResult<BookSchema.Main> {
  return fromAtcuteResult(safeParse(BookSchema.mainSchema, v));
}

export function validateBuzzRecord(
  v: unknown,
): ValidationResult<BuzzSchema.Main> {
  return fromAtcuteResult(safeParse(BuzzSchema.mainSchema, v));
}

export function validateMain(
  v: unknown,
): ValidationResult<StrongRefSchema.Main> {
  return fromAtcuteResult(safeParse(StrongRefSchema.mainSchema, v));
}
