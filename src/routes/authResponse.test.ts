import { describe, expect, test } from "bun:test";

import { authFailureBody, UNAUTHENTICATED_MESSAGE } from "./authResponse";

// The body deliberately carries four keys, since its readers do not agree on
// which one to read, and each is load-bearing somewhere.
describe("authFailureBody", () => {
  test("carries every key its readers look for", () => {
    expect(authFailureBody()).toEqual({
      // `bookApi.ts` treats this as a failure even on a 2xx.
      success: false,
      // What a caller should branch on.
      code: "unauthenticated",
      // The iOS uploader renders this verbatim.
      error: UNAUTHENTICATED_MESSAGE,
      // What `bookApi.ts` surfaces to the user.
      message: UNAUTHENTICATED_MESSAGE,
    });
  });

  test("error and message always agree", () => {
    // Two names for the same string, so a client reading either gets the same sentence.
    const body = authFailureBody("Custom reason.");
    expect(body.error).toBe("Custom reason.");
    expect(body.message).toBe("Custom reason.");
  });

  test("the default message is prose a user can act on", () => {
    // Reaches already-installed iOS builds with nothing shipped, so it has to be readable as-is.
    expect(UNAUTHENTICATED_MESSAGE).toMatch(/sign in/i);
    expect(UNAUTHENTICATED_MESSAGE).not.toBe("Unauthorized");
  });

  test("success is literally false, not falsy", () => {
    // `bookApi.ts` checks `=== false`, so `undefined` would read as success if not also status-checked.
    expect(authFailureBody().success).toBe(false);
  });
});
