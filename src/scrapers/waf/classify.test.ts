import { describe, expect, test } from "bun:test";
import { classifyFetch } from "./classify";

/// One classifier for every Goodreads fetch, plain or token-bearing.
///
/// It exists because "no `__NEXT_DATA__`" says nothing on its own. Production
/// logged 5,297 undiagnosable `waf_token_ineffective` events in 24h on
/// 2026-08-01 by conflating three root causes with three different fixes. What
/// carries the signal is the status plus `x-amzn-waf-action`. Measured:
///
///   - production UA, WAF challenged by request rate: 202 -> solve -> 200 (21/21)
///   - HeadlessChrome UA:                             202 -> solve -> 403 (25/25)
///   - Hetzner egress, 2026-08-03:                    202 -> solve -> 202 (4/4)
///
/// Same solver, same token mechanics; only the client differed. The last row is
/// why this host's solves are futile — and why the fetch path must not care.

describe("classifyFetch", () => {
  test("the marker is proof we have the page, whatever the status", () => {
    expect(classifyFetch(200, null, true)).toBe("page");
    // If the book data is in the body, we have what we came for.
    expect(classifyFetch(203, null, true)).toBe("page");
  });

  test("WAF re-challenging is the WAF, not the origin", () => {
    expect(classifyFetch(202, "challenge", false)).toBe("challenged");
  });

  test("a 202 counts as a challenge even if the action header is stripped", () => {
    // CloudFront returns an empty-bodied 202 when the request's Accept header
    // doesn't ask for text/html; the action header is the primary signal but the
    // status alone is enough.
    expect(classifyFetch(202, null, false)).toBe("challenged");
  });

  test("any WAF action means the WAF generated the response", () => {
    expect(classifyFetch(403, "block", false)).toBe("challenged");
    expect(classifyFetch(405, "captcha", false)).toBe("challenged");
  });

  test("403 with no WAF action is Goodreads' origin refusing us", () => {
    // The observed shape: `server: Server`, an `x-amz-rid`, and a plain
    // "403 Forbidden" body. We cleared the WAF; re-solving cannot help.
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
