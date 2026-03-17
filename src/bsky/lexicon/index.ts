export { ids } from "./ids.js";
export {
  validateBookRecord,
  validateBuzzRecord,
  validateListRecord,
  validateListItemRecord,
  validateMain,
  type ValidationResult,
} from "./validators.js";
import * as BookSchema from "./generated/types/buzz/bookhive/book.js";
import * as BuzzSchema from "./generated/types/buzz/bookhive/buzz.js";
import * as ListSchema from "./generated/types/social/popfeed/feed/list.js";
import * as ListItemSchema from "./generated/types/social/popfeed/feed/listItem.js";
import {
  validateBookRecord,
  validateBuzzRecord,
  validateListRecord,
  validateListItemRecord,
} from "./validators.js";
export const Book = { ...BookSchema, validateRecord: validateBookRecord };
export namespace Book {
  export type Record = BookSchema.Main;
}
export const Buzz = { ...BuzzSchema, validateRecord: validateBuzzRecord };
export namespace Buzz {
  export type Record = BuzzSchema.Main;
}
export const List = { ...ListSchema, validateRecord: validateListRecord };
export namespace List {
  export type Record = ListSchema.Main;
}
export const ListItem = { ...ListItemSchema, validateRecord: validateListItemRecord };
export namespace ListItem {
  export type Record = ListItemSchema.Main;
}

export * from "./generated/index.js";
