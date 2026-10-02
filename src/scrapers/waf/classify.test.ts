import { describe, expect, test } from "bun:test";
import { classifyFetch } from "./classify";

/// One classifier for every Goodreads fetch, plain or token-bearing.
///
/// "No `__NEXT_DATA__`" says nothing on its own — different clients can reach
/// the same absence of a marker for different reasons. What carries the signal
/// is the status plus `x-amzn-waf-action`, not the marker's absence alone.

describe("classifyFetch", () => {
  test("the marker is proof we have the page, whatever the status", () => {
    expect(classifyFetch(200, null, true)).toBe("page");
    expect(classifyFetch(203, null, true)).toBe("page");
  });

  test("WAF re-challenging is the WAF, not the origin", () => {
    expect(classifyFetch(202, "challenge", false)).toBe("challenged");
  });

  test("a 202 counts as a challenge even if the action header is stripped", () => {
    // CloudFront can return an empty 202 with no action header; status alone is enough.
    expect(classifyFetch(202, null, false)).toBe("challenged");
  });

  test("any WAF action means the WAF generated the response", () => {
    expect(classifyFetch(403, "block", false)).toBe("challenged");
    expect(classifyFetch(405, "captcha", false)).toBe("challenged");
  });

  test("403 with no WAF action is Goodreads' origin refusing us", () => {
    // We cleared the WAF; this is Goodreads' own origin refusing us, and re-solving cannot help.
    expect(classifyFetch(403, null, false)).toBe("origin_error");
  });

  test("rate limiting and origin errors are not WAF problems", () => {
    expect(classifyFetch(429, null, false)).toBe("origin_error");
    expect(classifyFetch(500, null, false)).toBe("origin_error");
    expect(classifyFetch(503, null, false)).toBe("origin_error");
  });

  test("a 2xx without the marker is a page problem, not a WAF problem", () => {
    expect(classifyFetch(200, null, false)).toBe("no_next_data");
    expect(classifyFetch(204, null, false)).toBe("no_next_data");
  });

  test("redirects that never resolved are page problems", () => {
    expect(classifyFetch(301, null, false)).toBe("no_next_data");
  });
});
