import { describe, expect, test } from "bun:test";
import { classifyTokenFetch } from "./solver-worker";

/// Regression tests for the failure-reason split.
///
/// Before this existed, every page fetch that came back without `__NEXT_DATA__`
/// after a successful solve was reported as `waf_token_ineffective`. Production
/// logged 5,297 of those in 24h on 2026-08-01 and they were undiagnosable,
/// because three unrelated root causes — each with a different fix — all landed
/// under the one label. Measured on 2026-08-02:
///
///   - production UA, WAF challenged by request rate: 202 -> solve -> 200 (21/21)
///   - HeadlessChrome UA:                             202 -> solve -> 403 (25/25)
///
/// Same solver, same token mechanics; only the client's identity differed. So
/// "no __NEXT_DATA__" says nothing on its own — the status and the
/// `x-amzn-waf-action` header are what carry the signal.

describe("classifyTokenFetch", () => {
  test("WAF re-challenging is a genuine token rejection", () => {
    expect(classifyTokenFetch(202, "challenge")).toBe("waf_token_rejected");
  });

  test("a 202 counts as a rejection even if the action header is stripped", () => {
    // CloudFront returns an empty-bodied 202 when the request's Accept header
    // doesn't ask for text/html; the action header is the primary signal but the
    // status alone is enough.
    expect(classifyTokenFetch(202, null)).toBe("waf_token_rejected");
  });

  test("any WAF action means the WAF generated the response, not the origin", () => {
    expect(classifyTokenFetch(403, "block")).toBe("waf_token_rejected");
    expect(classifyTokenFetch(405, "captcha")).toBe("waf_token_rejected");
  });

  test("403 with no WAF action is Goodreads' origin refusing us", () => {
    // The observed shape: `server: Server`, an `x-amz-rid`, and a plain
    // "403 Forbidden" body. We cleared the WAF; re-solving cannot help.
    expect(classifyTokenFetch(403, null)).toBe("origin_blocked_after_token");
  });

  test("rate limiting and origin errors are also not token problems", () => {
    expect(classifyTokenFetch(429, null)).toBe("origin_blocked_after_token");
    expect(classifyTokenFetch(500, null)).toBe("origin_blocked_after_token");
    expect(classifyTokenFetch(503, null)).toBe("origin_blocked_after_token");
  });

  test("a 2xx without __NEXT_DATA__ is a page problem, not a WAF problem", () => {
    expect(classifyTokenFetch(200, null)).toBe("page_without_next_data");
    expect(classifyTokenFetch(204, null)).toBe("page_without_next_data");
  });

  test("redirects that never resolved are page problems, not token problems", () => {
    expect(classifyTokenFetch(301, null)).toBe("page_without_next_data");
  });
});
