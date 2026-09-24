// Regression for an outage where an unreachable PDS wedged the cross-process
// lock — its heartbeat kept renewing it, so every request for that DID piled
// up behind it. These tests model that shape against the real lock and guard.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "kysely";

import { createSharedKvDb, type KvDb } from "../sqlite-kv";
import { createCrossProcessLock } from "./refresh-lock";
import { guardedRestore, resetRestoreGuards } from "./restore-guard";

// Stand-ins for the real RESTORE_TIMEOUT_MS and lock wait budget, scaled down
// so the tests don't sit through the real waits; the lock budget stays the
// tighter of the two, matching production.
const RESTORE_TIMEOUT = 120;
const LOCK_MAX_WAIT = 60;

let db: KvDb;

// Lets each fake stall be aborted at teardown — a genuinely never-settling
// promise would outlive the test and hit a destroyed Kysely driver.
let releases: Array<() => void> = [];

beforeEach(() => {
  db = createSharedKvDb(":memory:").db;
  resetRestoreGuards();
  releases = [];
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  // Let each lock's `finally` land its DELETE before the driver goes away.
  // Polled rather than slept: the releases above resolve on the next tick, so a
  // fixed sleep is either flaky or (as at 100ms x 3 tests) a third of this
  // file's runtime spent waiting for something that already happened.
  for (let i = 0; i < 40; i++) {
    const rows = await sql`SELECT COUNT(*) AS n FROM auth_refresh_lock`.execute(db);
    if (Number((rows.rows[0] as { n: number }).n) === 0) break;
    await Bun.sleep(5);
  }
  await db.destroy();
});

/** A host that accepts the connection and never answers. */
const blackhole = (): Promise<never> =>
  new Promise<never>((_, reject) => {
    releases.push(() => reject(new Error("test teardown")));
  });

describe("unreachable PDS", () => {
  it("does not let a wedged refresh pin later requests for the full lock budget", async () => {
    const lock = createCrossProcessLock(db, { maxWaitMs: LOCK_MAX_WAIT });

    // Request 1 acquires the lock and hangs on the dead host; nothing awaits it — the wedged holder.
    void guardedRestore(
      "caramelo.social.br",
      () => lock("oauth-session-did:plc:victim", blackhole),
      undefined,
      RESTORE_TIMEOUT,
    ).catch(() => {});
    await Bun.sleep(50);

    // Requests 2..N pile in behind it, as they did in production.
    const start = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        guardedRestore(
          "caramelo.social.br",
          () => lock("oauth-session-did:plc:victim", blackhole),
          undefined,
          RESTORE_TIMEOUT,
        ),
      ),
    );
    const elapsed = Date.now() - start;

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    // The whole batch must clear inside the bounded wait budget, not each request paying it separately.
    expect(elapsed).toBeLessThan(LOCK_MAX_WAIT + RESTORE_TIMEOUT);
  }, 30_000);

  it("stops dispatching to the dead host once the breaker trips", async () => {
    const lock = createCrossProcessLock(db, { maxWaitMs: LOCK_MAX_WAIT });
    let dispatches = 0;

    const attempt = () =>
      guardedRestore(
        "caramelo.social.br",
        () =>
          lock("oauth-session-did:plc:victim", () => {
            dispatches++;
            return blackhole();
          }),
        undefined,
        RESTORE_TIMEOUT,
      ).catch((e: Error) => e.name);

    // Trip it.
    await Promise.all([attempt(), attempt(), attempt()]);
    const before = dispatches;

    // Subsequent traffic must cost nothing at all — no lock, no SQLite, no socket — to keep one dead PDS off the event loop.
    const start = Date.now();
    const names = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const elapsed = Date.now() - start;

    expect(dispatches).toBe(before);
    expect(names.every((n) => n === "PdsUnavailableError")).toBe(true);
    expect(elapsed).toBeLessThan(100);
  }, 30_000);

  it("leaves users on healthy PDSes completely unaffected", async () => {
    const lock = createCrossProcessLock(db, { maxWaitMs: LOCK_MAX_WAIT });

    // Trip the breaker on the dead host. Concurrently, not in sequence: the
    // three attempts are only here to reach the failure threshold, and awaiting
    // them one at a time paid the full restore timeout three times over for no
    // added coverage. Test 2 above already trips it the same way.
    await Promise.all(
      Array.from({ length: 3 }, () =>
        guardedRestore(
          "caramelo.social.br",
          () => lock("oauth-session-did:plc:victim", blackhole),
          undefined,
          RESTORE_TIMEOUT,
        ).catch(() => {}),
      ),
    );

    const start = Date.now();
    const result = await guardedRestore(
      "bsky.social",
      () => lock("oauth-session-did:plc:healthy", async () => "session"),
      undefined,
      RESTORE_TIMEOUT,
    );
    expect(result).toBe("session");
    // Tied to the timeout rather than a loose 1s: a healthy PDS must not pay the
    // dead one's restore budget at all, which is a stronger claim than "under a
    // second" and survives the constants being scaled.
    expect(Date.now() - start).toBeLessThan(RESTORE_TIMEOUT);
  }, 30_000);
});
