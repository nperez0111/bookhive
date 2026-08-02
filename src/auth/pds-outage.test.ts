/**
 * Regression for the 2026-08-01/02 outage.
 *
 * One user's PDS (`caramelo.social.br`) began blackholing packets. Because
 * `oauthClient.restore()` had no timeout, the refresh hung while holding the
 * cross-process lock — whose heartbeat renewed it, so it was never evicted as
 * stale. Every other request for that DID, across all three worker processes,
 * then burned the lock's full 37.5s poll budget, each poll issuing three
 * synchronous SQLite statements. Workers stopped servicing their event loops;
 * Caddy recorded 166,450 `dial tcp: i/o timeout` and 171,145 502s.
 *
 * These tests model that shape against the real lock and the real guard.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSharedKvDb, type KvDb } from "../sqlite-kv";
import { createCrossProcessLock } from "./refresh-lock";
import { guardedRestore, resetRestoreGuards, RESTORE_TIMEOUT_MS } from "./restore-guard";

let db: KvDb;

/**
 * Releases for every in-flight fake stall. A genuinely never-settling promise
 * would outlive the test and then hit a destroyed Kysely driver, so the hang is
 * abortable — the code under test can't tell the difference, since it only ever
 * sees "still pending" for as long as the assertions run.
 */
let releases: Array<() => void> = [];

beforeEach(() => {
  db = createSharedKvDb(":memory:").db;
  resetRestoreGuards();
  releases = [];
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  // Let each lock's `finally` land its DELETE before the driver goes away.
  await Bun.sleep(100);
  await db.destroy();
});

/** A host that accepts the connection and never answers. */
const blackhole = (): Promise<never> =>
  new Promise<never>((_, reject) => {
    releases.push(() => reject(new Error("test teardown")));
  });

describe("unreachable PDS", () => {
  it("does not let a wedged refresh pin later requests for the full lock budget", async () => {
    const lock = createCrossProcessLock(db);

    // Request 1 acquires the lock and hangs on the dead host. Nothing awaits
    // it — this is the wedged holder.
    void guardedRestore("caramelo.social.br", () =>
      lock("oauth-session-did:plc:victim", blackhole),
    ).catch(() => {});
    await Bun.sleep(50);

    // Requests 2..N pile in behind it, as they did in production.
    const start = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        guardedRestore("caramelo.social.br", () => lock("oauth-session-did:plc:victim", blackhole)),
      ),
    );
    const elapsed = Date.now() - start;

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    // Old behaviour: every one of these sat for ~37.5s. The whole batch must
    // now clear in about one restore timeout.
    expect(elapsed).toBeLessThan(RESTORE_TIMEOUT_MS + 3_000);
  }, 30_000);

  it("stops dispatching to the dead host once the breaker trips", async () => {
    const lock = createCrossProcessLock(db);
    let dispatches = 0;

    const attempt = () =>
      guardedRestore("caramelo.social.br", () =>
        lock("oauth-session-did:plc:victim", () => {
          dispatches++;
          return blackhole();
        }),
      ).catch((e: Error) => e.name);

    // Trip it.
    await Promise.all([attempt(), attempt(), attempt()]);
    const before = dispatches;

    // Subsequent traffic must cost nothing at all — no lock, no SQLite, no
    // socket. This is what keeps one dead PDS off the event loop.
    const start = Date.now();
    const names = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const elapsed = Date.now() - start;

    expect(dispatches).toBe(before);
    expect(names.every((n) => n === "PdsUnavailableError")).toBe(true);
    expect(elapsed).toBeLessThan(100);
  }, 30_000);

  it("leaves users on healthy PDSes completely unaffected", async () => {
    const lock = createCrossProcessLock(db);

    for (let i = 0; i < 3; i++) {
      await guardedRestore("caramelo.social.br", () =>
        lock("oauth-session-did:plc:victim", blackhole),
      ).catch(() => {});
    }

    const start = Date.now();
    const result = await guardedRestore("bsky.social", () =>
      lock("oauth-session-did:plc:healthy", async () => "session"),
    );
    expect(result).toBe("session");
    expect(Date.now() - start).toBeLessThan(1_000);
  }, 30_000);
});
