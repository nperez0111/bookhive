export { ids } from "./ids.js";
export {
  validateBookRecord,
  validateBuzzRecord,
  validateMain,
  type ValidationResult,
} from "./validators.js";
import * as BookSchema from "./generated/types/buzz/bookhive/book.js";
import * as BuzzSchema from "./generated/types/buzz/bookhive/buzz.js";
import { validateBookRecord, validateBuzzRecord } from "./validators.js";
export const Book = { ...BookSchema, validateRecord: validateBookRecord };
export namespace Book {
  export type Record = BookSchema.Main;
}
export const Buzz = { ...BuzzSchema, validateRecord: validateBuzzRecord };
export namespace Buzz {
  export type Record = BuzzSchema.Main;
}

export * from "./generated/index.js";
