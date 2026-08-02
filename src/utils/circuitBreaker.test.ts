import { describe, it, expect } from "bun:test";

import { CircuitBreaker, type CircuitBreakerOptions } from "./circuitBreaker";

function makeBreaker(overrides: Partial<CircuitBreakerOptions> = {}) {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 10,
    consecutiveFailureThreshold: 5,
    windowMs: 60_000,
    cooldownMs: 15 * 60_000,
    halfOpenMax: 2,
    successThreshold: 2,
    now: () => now,
    ...overrides,
  });
  return {
    breaker,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  it("stays closed while calls succeed", () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 20; i++) {
      expect(breaker.canRequest()).toBe(true);
      breaker.recordSuccess();
    }
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after consecutive failures and stops dispatching", () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 5; i++) {
      expect(breaker.canRequest()).toBe(true);
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe("open");
    expect(breaker.canRequest()).toBe(false);
  });

  it("opens on the windowed threshold even when successes interleave", () => {
    const { breaker, advance } = makeBreaker({ consecutiveFailureThreshold: 100 });
    for (let i = 0; i < 9; i++) {
      breaker.recordFailure();
      advance(1000);
    }
    expect(breaker.getState()).toBe("closed");
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });

  it("forgets failures that age out of the window", () => {
    const { breaker, advance } = makeBreaker({ consecutiveFailureThreshold: 100 });
    for (let i = 0; i < 9; i++) breaker.recordFailure();
    advance(61_000);
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");
  });

  it("half-opens after the cooldown and closes on enough probe successes", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    advance(15 * 60_000);
    expect(breaker.getState()).toBe("half_open");

    expect(breaker.canRequest()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("half_open");
    expect(breaker.canRequest()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
  });

  it("caps concurrent probes while half-open", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    advance(15 * 60_000);

    expect(breaker.canRequest()).toBe(true);
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.canRequest()).toBe(false); // halfOpenMax = 2
  });

  it("reopens for a full cooldown when a probe fails", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    advance(15 * 60_000);

    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
    expect(breaker.cooldownRemainingMs()).toBe(15 * 60_000);

    advance(60_000);
    expect(breaker.getState()).toBe("open");
  });
});
