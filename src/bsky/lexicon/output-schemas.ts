/**
 * Output schema type aliases for XRPC handlers.
 * Generated modules use $output; this file provides OutputSchema for backward compatibility.
 */
import type * as GetBook from "./generated/types/buzz/bookhive/getBook.js";
import type * as GetBookIdentifiers from "./generated/types/buzz/bookhive/getBookIdentifiers.js";
import type * as GetProfile from "./generated/types/buzz/bookhive/getProfile.js";

export type GetBookOutputSchema = GetBook.$output;
export type GetBookIdentifiersOutputSchema = GetBookIdentifiers.$output;
export type GetProfileOutputSchema = GetProfile.$output;
