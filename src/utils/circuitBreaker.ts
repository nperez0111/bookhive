/**
 * Three-state circuit breaker (CLOSED → OPEN → HALF_OPEN → CLOSED).
 *
 * Added after the 2026-08-01 outage: the Goodreads WAF solver was failing ~90%
 * of the time and the app retried into the wall 5,000+ times a day, each retry
 * spawning a Worker and a full cold solve. When the breaker is open the caller
 * must not dispatch any work at all.
 *
 * The cooldown is deliberately long (minutes, not seconds). With a failure rate
 * that high, a short cooldown just reopens on every cycle and lets a burst
 * through each time.
 */

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = {
  /** Failures inside `windowMs` that trip the breaker. */
  failureThreshold: number;
  /** Consecutive failures that trip it regardless of the window. */
  consecutiveFailureThreshold: number;
  /** Rolling window for `failureThreshold`. */
  windowMs: number;
  /** How long to stay open before allowing probes. */
  cooldownMs: number;
  /** Concurrent probes allowed while half-open. */
  halfOpenMax: number;
  /** Probe successes needed to close again. */
  successThreshold: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export class CircuitBreaker {
  private readonly options: Required<Omit<CircuitBreakerOptions, "now">>;
  private readonly now: () => number;

  private state: CircuitState = "closed";
  private failureTimes: number[] = [];
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probesInFlight = 0;
  private probeSuccesses = 0;

  constructor(options: CircuitBreakerOptions) {
    const { now, ...rest } = options;
    this.options = rest;
    this.now = now ?? (() => Date.now());
  }

  /** Current state, after applying any pending cooldown transition. */
  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  /**
   * True if the caller may proceed. In half-open this reserves a probe slot, so
   * every `true` must be followed by exactly one of `recordSuccess()`,
   * `recordFailure()`, or — when the caller never dispatched anything upstream —
   * `recordAbandoned()`, which returns the slot without counting either way.
   * Skipping the call leaks a probe slot and can wedge the breaker half-open.
   */
  canRequest(): boolean {
    this.maybeHalfOpen();

    if (this.state === "closed") return true;
    if (this.state === "open") return false;

    if (this.probesInFlight >= this.options.halfOpenMax) return false;
    this.probesInFlight++;
    return true;
  }

  /**
   * Give back a probe slot reserved by `canRequest()` without judging the
   * upstream. For when the caller never actually dispatched — our own
   * backpressure, a cancelled request — so it counts neither as evidence of
   * recovery nor of failure.
   */
  recordAbandoned(): void {
    if (this.state === "half_open") {
      this.probesInFlight = Math.max(0, this.probesInFlight - 1);
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.failureTimes = [];

    if (this.state === "half_open") {
      this.probesInFlight = Math.max(0, this.probesInFlight - 1);
      this.probeSuccesses++;
      if (this.probeSuccesses >= this.options.successThreshold) this.close();
    }
  }

  recordFailure(): void {
    if (this.state === "half_open") {
      // A probe failed — straight back to open for another full cooldown.
      this.probesInFlight = Math.max(0, this.probesInFlight - 1);
      this.open();
      return;
    }

    const now = this.now();
    this.consecutiveFailures++;
    this.failureTimes.push(now);
    const cutoff = now - this.options.windowMs;
    this.failureTimes = this.failureTimes.filter((t) => t > cutoff);

    if (
      this.consecutiveFailures >= this.options.consecutiveFailureThreshold ||
      this.failureTimes.length >= this.options.failureThreshold
    ) {
      this.open();
    }
  }

  /** Milliseconds until probes are allowed again (0 when not open). */
  cooldownRemainingMs(): number {
    if (this.state !== "open") return 0;
    return Math.max(0, this.openedAt + this.options.cooldownMs - this.now());
  }

  private maybeHalfOpen(): void {
    if (this.state !== "open") return;
    if (this.now() - this.openedAt < this.options.cooldownMs) return;
    this.state = "half_open";
    this.probesInFlight = 0;
    this.probeSuccesses = 0;
  }

  private open(): void {
    this.state = "open";
    this.openedAt = this.now();
    this.probesInFlight = 0;
    this.probeSuccesses = 0;
    this.failureTimes = [];
  }

  private close(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.failureTimes = [];
    this.probesInFlight = 0;
    this.probeSuccesses = 0;
  }
}
