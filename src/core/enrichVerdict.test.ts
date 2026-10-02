import { describe, expect, test } from "bun:test";

import {
  deadVerdict,
  deferVerdict,
  retryVerdict,
  verdictFields,
  verdictKindFrom,
} from "./enrichVerdict";

describe("verdictFields", () => {
  test("emits both keys together, so they cannot describe different things", () => {
    expect(verdictFields(deferVerdict("waf_challenged"))).toEqual({
      enrich_retry: "defer",
      scrape_failure: "waf_challenged",
    });
  });

  test("round-trips through the bag", () => {
    for (const verdict of [retryVerdict("a"), deferVerdict("b"), deadVerdict("c")]) {
      expect(verdictKindFrom(verdictFields(verdict))).toBe(verdict.kind);
    }
  });
});

describe("verdictKindFrom", () => {
  test("an undeclared verdict is a defer, not a retry", () => {
    // This is the whole point of the module. The old default was `retry`, so a
    // producer that forgot the line spent one of four attempts and moved the
    // book a quarter of the way to a 7-day tombstone — without a request to
    // Goodreads ever having been sent on its behalf.
    expect(verdictKindFrom({})).toBe("defer");
    expect(verdictKindFrom({ enrichment: "failed" })).toBe("defer");
  });

  test("a failure string alone does not imply an attempt was spent", () => {
    // `waf_token_rejected` is emitted by the solver *with* `enrich_retry:
    // "defer"`. Reading only `scrape_failure` is how the two came apart.
    expect(verdictKindFrom({ scrape_failure: "waf_token_rejected" })).toBe("defer");
  });

  test("garbage in the bag is a defer", () => {
    expect(verdictKindFrom({ enrich_retry: "RETRY" })).toBe("defer");
    expect(verdictKindFrom({ enrich_retry: 1 })).toBe("defer");
    expect(verdictKindFrom({ enrich_retry: null })).toBe("defer");
  });

  test("the two verdicts that cost something must be declared explicitly", () => {
    expect(verdictKindFrom({ enrich_retry: "retry" })).toBe("retry");
    expect(verdictKindFrom({ enrich_retry: "dead" })).toBe("dead");
  });
});
