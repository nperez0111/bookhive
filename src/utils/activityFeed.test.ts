import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import { BOOK_STATUS } from "../constants";
import type { HiveId } from "../types";
import {
  collapseBursts,
  decodeFeedCursor,
  encodeFeedCursor,
  getActivityFeed,
  type FeedCtx,
  type FeedItem,
} from "./activityFeed";

const ME = "did:plc:me";
const ALICE = "did:plc:alice";
const BOB = "did:plc:bob";

let sqlite: DatabaseSync;
let db: Database;

async function createTestDb() {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
}

/**
 * The feed core only needs db + resolver + kv + getSessionAgent. `getProfiles`
 * short-circuits to the public client with no session and writes into the kv
 * stub, so avatars come back empty — which is fine, none of these assertions
 * are about avatars.
 */
function ctxFor(): FeedCtx {
  const store = new Map<string, unknown>();
  return {
    db,
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      getMeta: async () => null,
      set: async (k: string, v: unknown) => void store.set(k, v),
      setMeta: async () => {},
    } as unknown as FeedCtx["kv"],
    getSessionAgent: async () => null,
    resolver: {
      resolveDidsToHandles: async (dids: string[]) =>
        Object.fromEntries(dids.map((d) => [d, `${d.split(":").at(-1)}.test`])),
    },
  };
}

let seq = 0;

async function insertBook({
  userDid,
  hiveId,
  createdAt,
  indexedAt,
  status = BOOK_STATUS.FINISHED,
  stars = null,
  review = null,
}: {
  userDid: string;
  hiveId: string;
  createdAt: string;
  indexedAt: string;
  status?: string | null;
  stars?: number | null;
  review?: string | null;
}) {
  const n = ++seq;
  await db
    .insertInto("user_book")
    .values({
      uri: `at://${userDid}/buzz.bookhive.book/${String(n).padStart(6, "0")}`,
      cid: `cid${n}`,
      userDid,
      hiveId: hiveId as HiveId,
      title: `Book ${n}`,
      authors: "Author",
      createdAt,
      indexedAt,
      status,
      owned: 0,
      startedAt: null,
      finishedAt: null,
      review,
      stars,
      bookProgress: null,
      previousReads: null,
    })
    .execute();
}

const iso = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString();
/** Seconds-resolution clock, for rows that must land inside the 5-minute burst window. */
const isoSec = (sec: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, sec)).toISOString();

describe("feed cursor", () => {
  it("round-trips", () => {
    const c = encodeFeedCursor("2026-01-01T00:00:00.000Z", "at://did:plc:x/c/1");
    expect(decodeFeedCursor(c)).toEqual({
      ts: "2026-01-01T00:00:00.000Z",
      uri: "at://did:plc:x/c/1",
    });
  });

  it("returns null rather than throwing on anything malformed", () => {
    // A tampered or stale cursor must render page 1, never a 500.
    for (const bad of [
      undefined,
      "",
      "!!!not base64!!!",
      encodeFeedCursor("not-a-date", "at://did:plc:x/c/1"),
      Buffer.from("2026-01-01T00:00:00.000Z no-at-uri").toString("base64url"),
      Buffer.from("noseparator").toString("base64url"),
    ]) {
      expect(decodeFeedCursor(bad)).toBeNull();
    }
  });
});

describe("collapseBursts", () => {
  /** `sec` is seconds, so a run of N stays inside the 5-minute burst window. */
  const item = (actorDid: string, sec: number, verb = "finished"): FeedItem => ({
    uri: `at://${actorDid}/c/${sec}`,
    ts: isoSec(sec),
    actorDid,
    verb,
    book: { hiveId: "bk_x", title: "t", authors: "a" } as unknown as FeedItem["book"],
  });

  it("collapses a same-actor run inside the window and leaves others alone", () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item(ALICE, 100 - i)),
      item(BOB, 90),
      item(BOB, 89),
    ];
    const { groups, consumed } = collapseBursts(items, 25, { hasMoreRaw: false });
    expect(groups[0]).toMatchObject({ kind: "burst", actorDid: ALICE, total: 5 });
    // Two BOB rows is below BURST_MIN, so they stay individual.
    expect(groups.slice(1).map((g) => g.kind)).toEqual(["single", "single"]);
    expect(consumed).toBe(7);
  });

  it("groups by actor across mixed verbs, and labels the mix 'logged'", () => {
    // The case that made this actor-keyed rather than (actor, verb)-keyed: a
    // real library re-sync interleaves statuses row by row, so a verb-sensitive
    // key broke the run every one or two rows and left the flood untouched.
    const items = [
      item(ALICE, 100, "finished"),
      item(ALICE, 99, "wants to read"),
      item(ALICE, 98, "finished"),
      item(ALICE, 97, "wants to read"),
    ];
    const { groups } = collapseBursts(items, 25, { hasMoreRaw: false });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "burst", total: 4, verb: "logged" });
  });

  it("keeps the shared verb as the label when a burst is all one verb", () => {
    const items = Array.from({ length: 4 }, (_, i) => item(ALICE, 100 - i, "finished"));
    const { groups } = collapseBursts(items, 25, { hasMoreRaw: false });
    expect(groups[0]).toMatchObject({ kind: "burst", verb: "finished" });
  });

  it("does not collapse a run of two", () => {
    const { groups } = collapseBursts([item(ALICE, 10), item(ALICE, 9)], 25, {
      hasMoreRaw: false,
    });
    expect(groups.map((g) => g.kind)).toEqual(["single", "single"]);
  });

  it("splits a run that falls outside the burst window", () => {
    // Three rows seconds apart, then one well beyond the 5-minute window.
    const items = [item(ALICE, 1000), item(ALICE, 999), item(ALICE, 998), item(ALICE, 100)];
    const { groups } = collapseBursts(items, 25, { hasMoreRaw: false });
    expect(groups[0]).toMatchObject({ kind: "burst", total: 3 });
    expect(groups[1]?.kind).toBe("single");
  });

  it("defers a SHORT open trailing run rather than splitting it into singles", () => {
    // ALICE's two rows might continue past the page boundary; emitting them as
    // singles here would scatter one run across two pages.
    const items = [item(BOB, 200), item(ALICE, 190), item(ALICE, 189)];
    const { groups, consumed } = collapseBursts(items, 25, { hasMoreRaw: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "single" });
    expect(consumed).toBe(1);
  });

  it("emits a LONG open trailing run as a truncated burst rather than deferring it", () => {
    // Deferring these collapsed pages to one or two display rows whenever a
    // single actor dominated the fetch — i.e. mid-import, exactly when the feed
    // is under the most pressure. "4+ books" is honest and fills the page.
    const items = [item(BOB, 200), ...Array.from({ length: 4 }, (_, i) => item(ALICE, 190 - i))];
    const { groups, consumed } = collapseBursts(items, 25, { hasMoreRaw: true });
    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ kind: "burst", total: 4, truncated: true });
    expect(consumed).toBe(5);
  });

  it("force-closes a burst that fills the whole page rather than returning nothing", () => {
    // The stall guard: an empty page while more data exists is worse than an
    // imprecise count.
    const items = Array.from({ length: 40 }, (_, i) => item(ALICE, 1000 - i));
    const { groups, consumed } = collapseBursts(items, 25, { hasMoreRaw: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "burst", truncated: true, total: 40 });
    expect(consumed).toBe(40);
  });
});

describe("getActivityFeed", () => {
  beforeEach(async () => {
    seq = 0;
    await createTestDb();
  });

  it("orders by indexedAt, not createdAt — the reported bug", async () => {
    // createdAt order is deliberately the reverse of indexedAt order. The feed
    // used to sort by createdAt while the UI displayed indexedAt, which is what
    // made the timestamps run non-monotonically and read as shuffled.
    await insertBook({ userDid: ALICE, hiveId: "bk_a", createdAt: iso(1), indexedAt: iso(300) });
    await insertBook({ userDid: BOB, hiveId: "bk_b", createdAt: iso(200), indexedAt: iso(200) });
    await insertBook({ userDid: ALICE, hiveId: "bk_c", createdAt: iso(300), indexedAt: iso(100) });

    const res = await getActivityFeed({ ctx: ctxFor(), viewerDid: ME, tab: "all" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const times = res.groups.map((g) => (g.kind === "single" ? g.item.ts : g.ts));
    expect(times).toEqual([iso(300), iso(200), iso(100)]);
    // And the displayed sequence is monotonically non-increasing.
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! <= times[i - 1]!).toBe(true);
    }
  });

  it("pages through every row exactly once with no duplicates or gaps", async () => {
    for (let i = 0; i < 23; i++) {
      // Distinct actors so nothing collapses into a burst.
      await insertBook({
        userDid: `did:plc:u${i}`,
        hiveId: `bk_${i}`,
        createdAt: iso(i),
        indexedAt: iso(i),
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await getActivityFeed({
        ctx: ctxFor(),
        viewerDid: ME,
        tab: "all",
        limit: 5,
        cursor,
      });
      if (!res.ok) throw new Error("auth");
      seen.push(...res.groups.map((g) => (g.kind === "single" ? g.item.uri : g.items[0]!.uri)));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
  });

  it("terminates and yields each row once when every timestamp is identical", async () => {
    // 5,262 distinct createdAt values were shared by 2+ rows on production.
    // Without `uri` as a tiebreaker SQLite may order ties differently between
    // requests, which silently drops rows from a paginated feed.
    const ts = iso(500);
    for (let i = 0; i < 12; i++) {
      await insertBook({
        userDid: `did:plc:u${i}`,
        hiveId: `bk_${i}`,
        createdAt: ts,
        indexedAt: ts,
      });
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await getActivityFeed({
        ctx: ctxFor(),
        viewerDid: ME,
        tab: "all",
        limit: 4,
        cursor,
      });
      if (!res.ok) throw new Error("auth");
      for (const g of res.groups) seen.add(g.kind === "single" ? g.item.uri : g.items[0]!.uri);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen.size).toBe(12);
  });

  it("advances the cursor past every row of a collapsed burst", async () => {
    // The infinite-loop guard. The cursor must come from the last RAW row
    // consumed, not the last display row: a cursor taken from a collapsed
    // burst's newest row would re-serve the same burst forever.
    //
    // Alice imports 10 books seconds apart (one burst); ten other people each
    // add one, spread out (ten singles). Paging must visit all 20 rows exactly
    // once and terminate.
    for (let i = 0; i < 10; i++) {
      await insertBook({
        userDid: ALICE,
        hiveId: `bk_a${i}`,
        createdAt: isoSec(900 - i),
        indexedAt: isoSec(900 - i),
      });
    }
    for (let i = 0; i < 10; i++) {
      await insertBook({
        userDid: `did:plc:other${i}`,
        hiveId: `bk_o${i}`,
        createdAt: iso(100 - i * 10),
        indexedAt: iso(100 - i * 10),
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let sawBurst = false;
    for (let page = 0; page < 25; page++) {
      const res = await getActivityFeed({
        ctx: ctxFor(),
        viewerDid: ME,
        tab: "all",
        limit: 3,
        cursor,
      });
      if (!res.ok) throw new Error("auth");
      for (const g of res.groups) {
        if (g.kind === "single") seen.push(g.item.uri);
        else {
          sawBurst = true;
          seen.push(...g.items.map((i) => i.uri));
        }
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(sawBurst).toBe(true);
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it("requires a viewer for the friends and tracking tabs but not for all", async () => {
    for (const tab of ["friends", "tracking"] as const) {
      const res = await getActivityFeed({ ctx: ctxFor(), viewerDid: null, tab });
      expect(res).toEqual({ ok: false, reason: "auth_required" });
    }
    const all = await getActivityFeed({ ctx: ctxFor(), viewerDid: null, tab: "all" });
    expect(all.ok).toBe(true);
  });

  it("treats a malformed cursor as page 1", async () => {
    await insertBook({ userDid: ALICE, hiveId: "bk_a", createdAt: iso(1), indexedAt: iso(1) });
    const res = await getActivityFeed({
      ctx: ctxFor(),
      viewerDid: ME,
      tab: "all",
      cursor: "totally-bogus",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.groups).toHaveLength(1);
  });

  it("scopes the friends tab to active follows", async () => {
    await insertBook({ userDid: ALICE, hiveId: "bk_a", createdAt: iso(3), indexedAt: iso(3) });
    await insertBook({ userDid: BOB, hiveId: "bk_b", createdAt: iso(2), indexedAt: iso(2) });
    await db
      .insertInto("user_follows")
      .values([
        {
          userDid: ME,
          followsDid: ALICE,
          followedAt: iso(0),
          syncedAt: iso(0),
          lastSeenAt: iso(0),
          isActive: 1,
        },
        {
          userDid: ME,
          followsDid: BOB,
          followedAt: iso(0),
          syncedAt: iso(0),
          lastSeenAt: iso(0),
          isActive: 0,
        },
      ])
      .execute();

    const res = await getActivityFeed({ ctx: ctxFor(), viewerDid: ME, tab: "friends" });
    if (!res.ok) throw new Error("auth");
    const actors = res.groups.map((g) => (g.kind === "single" ? g.item.actorDid : g.actorDid));
    expect(actors).toEqual([ALICE]);
  });

  it("truncates long reviews server-side", async () => {
    await insertBook({
      userDid: ALICE,
      hiveId: "bk_a",
      createdAt: iso(1),
      indexedAt: iso(1),
      review: "x".repeat(5000),
    });
    const res = await getActivityFeed({ ctx: ctxFor(), viewerDid: ME, tab: "all" });
    if (!res.ok) throw new Error("auth");
    const g = res.groups[0];
    const review = g?.kind === "single" ? g.item.book.review : null;
    expect(review!.length).toBeLessThan(300);
  });
});

describe("feed query plans", () => {
  // `bun:sqlite` is synchronous and production runs three processes, so a temp
  // B-tree sort here stalls a third of all traffic. Assert the plan rather than
  // trusting the planner — this database has never been ANALYZEd.
  beforeEach(async () => {
    seq = 0;
    await createTestDb();
  });

  it("uses idx_user_book_feed for the all tab, with no table scan or temp sort", () => {
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT ub.uri FROM user_book ub
         ORDER BY ub.indexedAt DESC, ub.uri DESC LIMIT 26`,
      )
      .all()
      .map((r) => (r as { detail: string }).detail)
      .join("\n");

    expect(plan).toContain("idx_user_book_feed");
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("uses idx_user_book_user_feed for the friends tab", () => {
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT ub.uri FROM user_book ub
          WHERE ub.userDid IN (SELECT followsDid FROM user_follows
                                WHERE userDid = ? AND isActive = 1)
          ORDER BY ub.indexedAt DESC, ub.uri DESC LIMIT 26`,
      )
      .all(ME)
      .map((r) => (r as { detail: string }).detail)
      .join("\n");

    expect(plan).toContain("idx_user_book_user_feed");
  });

  it("uses idx_user_book_hive_feed for the tracking tab", () => {
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT ub.uri FROM user_book ub
          WHERE ub.hiveId IN (SELECT hiveId FROM user_book WHERE userDid = ?)
          ORDER BY ub.indexedAt DESC, ub.uri DESC LIMIT 26`,
      )
      .all(ME)
      .map((r) => (r as { detail: string }).detail)
      .join("\n");

    expect(plan).toContain("idx_user_book_hive_feed");
  });
});
