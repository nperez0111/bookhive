import { beforeEach, describe, expect, mock, test } from "bun:test";
import { __resetSolverState, fetchGoodreadsViaWaf, type SolveFn } from "./solver";
import { NEXT_DATA_MARKER } from "./pageMarker";

/// The properties that replaced the circuit breaker.
///
/// Both `fetch` and the solve are injected, so no Worker is spawned and no
/// request leaves the machine. The crypto is not exercised here — the point is
/// the *decision* layer, which is where the outage actually lived.

const URL_A = "https://www.goodreads.com/book/show/1";
const PAGE_HTML = `<html><script id="${NEXT_DATA_MARKER}{}</script></html>`;
const CHALLENGE_HTML = `<html><script src="https://x.token.awswaf.com/a/b/c/challenge.js"></script></html>`;

function reply(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

const page = () => reply(200, PAGE_HTML);
const challenge = () => reply(202, CHALLENGE_HTML, { "x-amzn-waf-action": "challenge" });

/** A `fetch` that returns a canned response and counts calls. */
function stubFetch(respond: (call: number) => Response) {
  let calls = 0;
  const impl = mock(async () => respond(calls++));
  return { impl: impl as unknown as typeof fetch, calls: () => calls };
}

/** A solve that never spawns a Worker. Counts how often it was asked to run. */
function stubSolve(token: string | null = null) {
  let calls = 0;
  const impl: SolveFn = async () => {
    calls++;
    return {
      id: "test",
      token,
      config: null,
      challengeJsUrl: null,
      ...(token ? {} : { failure: "waf_solve_failed" }),
    };
  };
  return { impl, calls: () => calls };
}

beforeEach(() => {
  __resetSolverState();
});

describe("fetchGoodreadsViaWaf", () => {
  test("returns the page when the plain fetch works", async () => {
    const ctx: Record<string, unknown> = {};
    const fetchImpl = stubFetch(page);

    const html = await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(ctx, c), {
      fetchImpl: fetchImpl.impl,
    });

    expect(html).toBe(PAGE_HTML);
    expect(fetchImpl.calls()).toBe(1);
    expect(ctx["scrape_outcome"]).toBe("page");
    expect(ctx["enrich_retry"]).toBeUndefined();
  });

  // The invariant. This is the test that would have caught the original bug: the
  // breaker made `fetchGoodreadsViaWaf` return without dispatching anything, and
  // nothing asserted that couldn't happen.
  test("never skips the page fetch, whatever came before", async () => {
    const failures = [
      () => reply(500, "boom"),
      () => reply(403, "Forbidden"),
      () => reply(200, "<html>nothing</html>"),
      challenge,
    ];
    const fetchImpl = stubFetch((call) => failures[call % failures.length]!());
    const solveImpl = stubSolve();

    for (let i = 0; i < 100; i++) {
      await fetchGoodreadsViaWaf(`${URL_A}${i}`, () => {}, {
        fetchImpl: fetchImpl.impl,
        solveImpl: solveImpl.impl,
      });
    }

    // 100 attempts, 100 requests. The solve path may add more (a rejected token
    // costs a second fetch) but it can never subtract.
    expect(fetchImpl.calls()).toBeGreaterThanOrEqual(100);
  });

  test("a transport error defers rather than blaming the book", async () => {
    const ctx: Record<string, unknown> = {};
    const fetchImpl = mock(async () => {
      throw new Error("connect ETIMEDOUT");
    }) as unknown as typeof fetch;

    const html = await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(ctx, c), { fetchImpl });

    expect(html).toBeNull();
    expect(ctx["scrape_failure"]).toBe("fetch_failed");
    expect(ctx["enrich_retry"]).toBe("defer");
  });

  test("origin errors and unparseable pages defer, never 'dead'", async () => {
    for (const [status, body, expected] of [
      [403, "Forbidden", "origin_error"],
      [500, "boom", "origin_error"],
      [200, "<html>nothing</html>", "no_next_data"],
    ] as const) {
      __resetSolverState();
      const ctx: Record<string, unknown> = {};
      const fetchImpl = stubFetch(() => reply(status, body));

      const html = await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(ctx, c), {
        fetchImpl: fetchImpl.impl,
      });

      expect(html).toBeNull();
      expect(ctx["scrape_failure"]).toBe(expected);
      // Only the parser may say "dead" — see moreInfo.test.ts.
      expect(ctx["enrich_retry"]).toBe("defer");
    }
  });

  test("a challenge we can't solve defers and says why", async () => {
    const ctx: Record<string, unknown> = {};
    const fetchImpl = stubFetch(challenge);
    const solveImpl = stubSolve();

    const html = await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(ctx, c), {
      fetchImpl: fetchImpl.impl,
      solveImpl: solveImpl.impl,
    });

    expect(html).toBeNull();
    expect(ctx["scrape_outcome"]).toBe("challenged");
    expect(ctx["scrape_failure"]).toBe("waf_challenged");
    expect(ctx["scrape_solve"]).toBe("waf_solve_failed");
    expect(ctx["enrich_retry"]).toBe("defer");
  });

  test("a solved token that the WAF then refuses is reported distinctly", async () => {
    // The failure mode this host has been in since 2026-08-01: the solve works,
    // the WAF issues a token, and the re-fetch is challenged all over again.
    const ctx: Record<string, unknown> = {};
    const fetchImpl = stubFetch(challenge);
    const solveImpl = stubSolve("a-token");

    const html = await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(ctx, c), {
      fetchImpl: fetchImpl.impl,
      solveImpl: solveImpl.impl,
    });

    expect(html).toBeNull();
    expect(fetchImpl.calls()).toBe(2); // page, then the token re-fetch
    expect(ctx["scrape_failure"]).toBe("waf_token_rejected");
    expect(ctx["enrich_retry"]).toBe("defer");
  });

  test("a solved token that works caches for the next fetch", async () => {
    const fetchImpl = stubFetch((call) => (call === 0 ? challenge() : page()));
    const solveImpl = stubSolve("a-token");
    const second: Record<string, unknown> = {};

    expect(
      await fetchGoodreadsViaWaf(URL_A, () => {}, {
        fetchImpl: fetchImpl.impl,
        solveImpl: solveImpl.impl,
      }),
    ).toBe(PAGE_HTML);

    await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(second, c), {
      fetchImpl: fetchImpl.impl,
      solveImpl: solveImpl.impl,
    });

    expect(second["scrape_token"]).toBe("cached");
    expect(solveImpl.calls()).toBe(1);
  });

  // Single-flight plus the min-interval are what bound the expensive path now
  // that there is no pool, no semaphore and no breaker. If both were broken, a
  // WAF episode would spawn one Worker per queued book — the 2026-08-01 OOM.
  test("concurrent challenges collapse to a single solve", async () => {
    const fetchImpl = stubFetch(challenge);
    const solveImpl = stubSolve();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetchGoodreadsViaWaf(`${URL_A}${i}`, () => {}, {
          fetchImpl: fetchImpl.impl,
          solveImpl: solveImpl.impl,
        }),
      ),
    );

    // Every book still got its own request; they shared one solve.
    expect(fetchImpl.calls()).toBe(10);
    expect(solveImpl.calls()).toBe(1);
  });

  test("a second challenge soon after a failed solve does not re-solve", async () => {
    const fetchImpl = stubFetch(challenge);
    const solveImpl = stubSolve();
    const second: Record<string, unknown> = {};

    await fetchGoodreadsViaWaf(URL_A, () => {}, {
      fetchImpl: fetchImpl.impl,
      solveImpl: solveImpl.impl,
    });
    await fetchGoodreadsViaWaf(URL_A, (c) => Object.assign(second, c), {
      fetchImpl: fetchImpl.impl,
      solveImpl: solveImpl.impl,
    });

    // Both books were fetched; only the first paid for a solve.
    expect(fetchImpl.calls()).toBe(2);
    expect(solveImpl.calls()).toBe(1);
    expect(second["scrape_solve"]).toBe("skipped");
    expect(second["enrich_retry"]).toBe("defer");
  });
});
