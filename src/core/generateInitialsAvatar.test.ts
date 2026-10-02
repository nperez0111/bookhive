import { describe, expect, test } from "bun:test";

import { getInitials } from "./generateInitialsAvatar";

/** Every avatarless user's identity on the site comes out of this function. */
describe("getInitials", () => {
  test("strips the bookhive suffix before splitting", () => {
    // Order matters: split first and `alice.bookhive.social` yields "AB".
    expect(getInitials("alice.bookhive.social")).toBe("AL");
  });

  test("does not strip other suffixes", () => {
    expect(getInitials("alice.bsky.social")).toBe("AB");
  });

  test("splits on all three separators", () => {
    expect(getInitials("ada-lovelace")).toBe("AL");
    expect(getInitials("ada_lovelace")).toBe("AL");
    expect(getInitials("ada.lovelace")).toBe("AL");
  });

  test("a single part takes its first two letters", () => {
    expect(getInitials("ada")).toBe("AD");
    expect(getInitials("a")).toBe("A");
  });

  test("only the first two parts are used", () => {
    expect(getInitials("ada.byron.lovelace")).toBe("AB");
  });

  test("nothing usable falls back to '?', never an empty avatar", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("...")).toBe("?");
    expect(getInitials("---")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });

  test("leading and trailing separators do not produce empty parts", () => {
    expect(getInitials("--ada--")).toBe("AD");
    expect(getInitials(".ada.lovelace.")).toBe("AL");
  });
});
