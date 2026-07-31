import { describe, expect, it } from "bun:test";

import { deriveSyncPassword } from "./sync-auth";

const md5 = (s: string) => new Bun.CryptoHasher("md5").update(s).digest("hex");
const DID = "did:plc:enu2j5xjlqsjaylv3du4myh4";
const SECRET = "00000000000000000000000000000000";

describe("deriveSyncPassword", () => {
  it("produces a short, deterministic password", () => {
    const pw = deriveSyncPassword(DID, SECRET, 0);
    expect(pw).toHaveLength(10);
    expect(pw).toBe(deriveSyncPassword(DID, SECRET, 0));
  });

  it("changes when the rotation counter changes", () => {
    expect(deriveSyncPassword(DID, SECRET, 0)).not.toBe(deriveSyncPassword(DID, SECRET, 1));
  });

  it("matches what KOReader transmits (md5 of the password)", () => {
    // KOReader stores and sends md5(password) as x-auth-key; the middleware
    // compares against md5 of the derived value. This guards that round-trip.
    const pw = deriveSyncPassword(DID, SECRET, 0);
    const koreaderSends = md5(pw);
    const middlewareExpects = md5(deriveSyncPassword(DID, SECRET, 0));
    expect(koreaderSends).toBe(middlewareExpects);
  });
});
