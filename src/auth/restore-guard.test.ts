import { describe, it, expect, beforeEach } from "bun:test";
import {
  guardedRestore,
  isSessionTerminatingError,
  PdsUnavailableError,
  resetRestoreGuards,
  restoreGuardStates,
  MAX_BREAKERS,
} from "./restore-guard";

beforeEach(() => {
  resetRestoreGuards();
});

/** Never settles — stands in for a host that blackholes packets. */
const blackhole = () => new Promise<never>(() => {});

describe("isSessionTerminatingError", () => {
  it("treats credential rejections as terminal", () => {
    expect(isSessionTerminatingError(new Error("invalid_grant"))).toBe(true);
    expect(isSessionTerminatingError(new Error("refresh token was revoked"))).toBe(true);
  });

  it("treats network failures as transient", () => {
    // These are what silently logged users out before this distinction existed.
    expect(isSessionTerminatingError(new Error("The operation timed out."))).toBe(false);
    expect(
      isSessionTerminatingError(new Error("Unable to connect. Is the computer able to access")),
    ).toBe(false);
    expect(isSessionTerminatingError(new Error("Cross-process lock timeout for x"))).toBe(false);
  });
});

describe("guardedRestore", () => {
  it("returns the restored value and leaves the breaker closed", async () => {
    const result = await guardedRestore("pds.example", async () => "session");
    expect(result).toBe("session");
    expect(restoreGuardStates()[0]?.state).toBe("closed");
  });

  it("times out a hung restore instead of hanging the request", async () => {
    // A short override stands in for RESTORE_TIMEOUT_MS — the invariant is that a blackholing host is bounded, not the exact timeout length.
    const timeoutMs = 200;
    const start = Date.now();
    // Awaited directly, not via `expect().rejects`: the elapsed-time assertion
    // below depends on this having blocked, and `expect().rejects` returns
    // `undefined` so nothing in the expression expresses that dependency.
    const error = await guardedRestore("dead.example", blackhole, undefined, timeoutMs).catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain("timed out");
    expect(Date.now() - start).toBeLessThan(timeoutMs + 2_000);
  });

  it("stops dispatching to a host that keeps failing", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        guardedRestore("dead.example", async () => {
          throw new Error("Unable to connect.");
        }),
      ).rejects.toThrow();
    }

    // Fourth call must not reach the host at all.
    let dispatched = false;
    expect(
      guardedRestore("dead.example", async () => {
        dispatched = true;
        return "unreachable";
      }),
    ).rejects.toBeInstanceOf(PdsUnavailableError);
    expect(dispatched).toBe(false);
  });

  it("isolates hosts from each other", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        guardedRestore("dead.example", async () => {
          throw new Error("Unable to connect.");
        }),
      ).rejects.toThrow();
    }

    // A different PDS must be unaffected — one dead host cannot lock out the rest of the network.
    expect(guardedRestore("healthy.example", async () => "ok")).resolves.toBe("ok");
  });

  it("does not open the breaker on a revoked token", async () => {
    // The PDS answered us correctly; that is evidence of health, not sickness.
    for (let i = 0; i < 5; i++) {
      expect(
        guardedRestore("healthy.example", async () => {
          throw new Error("invalid_grant");
        }),
      ).rejects.toThrow("invalid_grant");
    }

    let dispatched = false;
    expect(
      guardedRestore("healthy.example", async () => {
        dispatched = true;
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(dispatched).toBe(true);
  });

  it("stays bounded even when every tracked host is open", async () => {
    // Mass PDS outage: eviction used to only consider closed breakers, so when every breaker was open the map grew unbounded — a leak inside the leak guard.
    for (let i = 0; i < MAX_BREAKERS + 50; i++) {
      // Trip each host so it lands open, never closed.
      for (let n = 0; n < 3; n++) {
        expect(
          guardedRestore(`dead-${i}.example`, async () => {
            throw new Error("Unable to connect.");
          }),
        ).rejects.toThrow();
      }
    }

    expect(restoreGuardStates().length).toBeLessThanOrEqual(MAX_BREAKERS);
    expect(restoreGuardStates().every((s) => s.state === "open")).toBe(true);
  });

  it("reports the outcome for the wide event", async () => {
    const outcomes: Array<{ key: string; state: string }> = [];
    await guardedRestore(
      "pds.example",
      async () => "ok",
      (o) => outcomes.push(o),
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.key).toBe("pds.example");
    expect(outcomes[0]?.state).toBe("closed");
  });
});
