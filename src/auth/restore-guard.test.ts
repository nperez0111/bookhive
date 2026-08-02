import { describe, it, expect, beforeEach } from "bun:test";
import {
  guardedRestore,
  isSessionTerminatingError,
  PdsUnavailableError,
  resetRestoreGuards,
  restoreGuardStates,
  RESTORE_TIMEOUT_MS,
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
    // These are what silently logged users out during the 2026-08-02 incident.
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

  it(
    "times out a hung restore instead of hanging the request",
    async () => {
      const start = Date.now();
      await expect(guardedRestore("dead.example", blackhole)).rejects.toThrow("timed out");
      expect(Date.now() - start).toBeLessThan(RESTORE_TIMEOUT_MS + 2_000);
    },
    RESTORE_TIMEOUT_MS + 5_000,
  );

  it("stops dispatching to a host that keeps failing", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        guardedRestore("dead.example", async () => {
          throw new Error("Unable to connect.");
        }),
      ).rejects.toThrow();
    }

    // Fourth call must not reach the host at all.
    let dispatched = false;
    await expect(
      guardedRestore("dead.example", async () => {
        dispatched = true;
        return "unreachable";
      }),
    ).rejects.toBeInstanceOf(PdsUnavailableError);
    expect(dispatched).toBe(false);
  });

  it("isolates hosts from each other", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        guardedRestore("dead.example", async () => {
          throw new Error("Unable to connect.");
        }),
      ).rejects.toThrow();
    }

    // A different PDS must be unaffected — one dead host cannot lock out the
    // rest of the network.
    await expect(guardedRestore("healthy.example", async () => "ok")).resolves.toBe("ok");
  });

  it("does not open the breaker on a revoked token", async () => {
    // The PDS answered us correctly; that is evidence of health, not sickness.
    for (let i = 0; i < 5; i++) {
      await expect(
        guardedRestore("healthy.example", async () => {
          throw new Error("invalid_grant");
        }),
      ).rejects.toThrow("invalid_grant");
    }

    let dispatched = false;
    await expect(
      guardedRestore("healthy.example", async () => {
        dispatched = true;
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(dispatched).toBe(true);
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
