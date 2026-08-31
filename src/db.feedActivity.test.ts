import { describe, it, expect, beforeEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";

import { wrapBunSqliteForKysely } from "./bun-sqlite-kysely";
import {
  FEED_INDEXED_AT_REPAIR_SQL,
  feedActivityIndexedAt,
  migrateToLatest,
  type Database,
  type DatabaseSchema,
} from "./db";
import { BOOK_STATUS } from "./constants";
import type { HiveId, UserBookRow } from "./types";

/**
 * `feedActivityIndexedAt` is the gate that keeps a library re-sync from re-dating
 * a user's whole back catalogue to "a few seconds ago" and flooding every
 * follower's feed. `refetchBooks` computes ONE timestamp and stamps it across
 * every row it upserts, so without this gate an unchanged book still moves.
 */

const DID = "did:plc:alice";
const URI = "at://did:plc:alice/buzz.bookhive.book/aaa";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-06-01T00:00:00.000Z";

let sqlite: DatabaseSync;
let db: Database;

function row(overrides: Partial<UserBookRow> = {}): UserBookRow {
  return {
    uri: URI,
    cid: "cid-1",
    userDid: DID,
    hiveId: "bk_test" as HiveId,
    title: "Dune",
    authors: "Frank Herbert",
    createdAt: OLD,
    indexedAt: OLD,
    status: BOOK_STATUS.READING,
    owned: 0,
    startedAt: null,
    finishedAt: null,
    review: null,
    stars: null,
    bookProgress: null,
    previousReads: null,
    ...overrides,
  } as UserBookRow;
}

/** Mirrors the shared upsert used by `refetchBooks` / `updateUserBook`. */
async function upsert(values: UserBookRow) {
  await db
    .insertInto("user_book")
    .values(values)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet((c) => ({
        indexedAt: feedActivityIndexedAt,
        cid: c.ref("excluded.cid"),
        title: c.ref("excluded.title"),
        authors: c.ref("excluded.authors"),
        status: c.ref("excluded.status"),
        owned: c.ref("excluded.owned"),
        startedAt: c.ref("excluded.startedAt"),
        finishedAt: c.ref("excluded.finishedAt"),
        review: c.ref("excluded.review"),
        stars: c.ref("excluded.stars"),
        bookProgress: c.ref("excluded.bookProgress"),
        previousReads: c.ref("excluded.previousReads"),
      })),
    )
    .execute();
}

async function indexedAt(): Promise<string> {
  const r = await db
    .selectFrom("user_book")
    .select("indexedAt")
    .where("uri", "=", URI)
    .executeTakeFirstOrThrow();
  return r.indexedAt;
}

describe("feedActivityIndexedAt", () => {
  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA journal_mode = WAL");
    db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
    });
    await migrateToLatest(db, sqlite);
    await upsert(row());
  });

  it("leaves indexedAt alone when nothing feed-visible changed", async () => {
    await upsert(row({ indexedAt: NEW }));
    expect(await indexedAt()).toBe(OLD);
  });

  it("leaves indexedAt alone for a KOReader progress ping", async () => {
    // The reason this gates on rendered fields rather than on `cid`: a user
    // reading for two hours would otherwise bump to the top of every
    // follower's feed roughly twenty times.
    await upsert(
      row({
        indexedAt: NEW,
        cid: "cid-2",
        bookProgress: JSON.stringify({ percent: 42, updatedAt: NEW }),
      }),
    );
    expect(await indexedAt()).toBe(OLD);
  });

  it("leaves indexedAt alone when only the title is normalised", async () => {
    await upsert(row({ indexedAt: NEW, cid: "cid-3", title: "DUNE" }));
    expect(await indexedAt()).toBe(OLD);
  });

  it("advances indexedAt on a status change", async () => {
    await upsert(row({ indexedAt: NEW, status: BOOK_STATUS.FINISHED }));
    expect(await indexedAt()).toBe(NEW);
  });

  it("advances indexedAt on a new review", async () => {
    await upsert(row({ indexedAt: NEW, review: "Loved it" }));
    expect(await indexedAt()).toBe(NEW);
  });

  it("advances indexedAt when stars go from NULL to a value", async () => {
    // The `IS NOT` vs `<>` test. With `<>`, comparing against NULL yields NULL,
    // the CASE falls to the ELSE, and rating a book for the first time silently
    // stops counting as activity.
    await upsert(row({ indexedAt: NEW, stars: 8 }));
    expect(await indexedAt()).toBe(NEW);
  });

  it("advances indexedAt when stars are cleared back to NULL", async () => {
    await upsert(row({ indexedAt: "2026-03-01T00:00:00.000Z", stars: 8 }));
    await upsert(row({ indexedAt: NEW, stars: null }));
    expect(await indexedAt()).toBe(NEW);
  });

  it("advances indexedAt on a finishedAt change", async () => {
    await upsert(row({ indexedAt: NEW, finishedAt: NEW }));
    expect(await indexedAt()).toBe(NEW);
  });

  it("does not move any row of an unchanged 50-book re-sync", async () => {
    // The flood test: `refetchBooks` shares one timestamp across the batch.
    const uris: string[] = [];
    for (let i = 0; i < 50; i++) {
      const uri = `at://${DID}/buzz.bookhive.book/b${i}`;
      uris.push(uri);
      await upsert(row({ uri, cid: `c${i}`, hiveId: `bk_${i}` as HiveId }));
    }
    for (let i = 0; i < 50; i++) {
      await upsert(
        row({ uri: uris[i]!, cid: `c${i}`, hiveId: `bk_${i}` as HiveId, indexedAt: NEW }),
      );
    }
    const rows = await db
      .selectFrom("user_book")
      .select("indexedAt")
      .where("uri", "in", uris)
      .execute();
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.indexedAt === OLD)).toBe(true);
  });
});

describe("migration 027 indexedAt repair", () => {
  it("clamps a re-sync stamp back down to the newest real evidence", async () => {
    // Simulate the pre-migration state: a row created in January whose
    // indexedAt was rewritten to June by a library re-sync.
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA journal_mode = WAL");
    const k = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(raw) }),
    });
    await migrateToLatest(k, raw);

    // Post-migration writes go through the gate, so assert the repair SQL
    // itself against hand-planted junk.
    await k
      .insertInto("user_book")
      .values([
        row({ uri: `${URI}-1`, hiveId: "bk_1" as HiveId, createdAt: OLD, indexedAt: NEW }),
        row({
          uri: `${URI}-2`,
          hiveId: "bk_2" as HiveId,
          createdAt: OLD,
          indexedAt: NEW,
          finishedAt: "2026-03-01T00:00:00.000Z",
        }),
        row({ uri: `${URI}-3`, hiveId: "bk_3" as HiveId, createdAt: OLD, indexedAt: OLD }),
      ])
      .execute();

    raw.exec(FEED_INDEXED_AT_REPAIR_SQL);

    const after = Object.fromEntries(
      (await k.selectFrom("user_book").select(["uri", "indexedAt"]).execute()).map((r) => [
        r.uri,
        r.indexedAt,
      ]),
    );

    // No evidence beyond creation → clamped to createdAt.
    expect(after[`${URI}-1`]).toBe(OLD);
    // A real finish date in March → clamped to that, not left at June.
    expect(after[`${URI}-2`]).toBe("2026-03-01T00:00:00.000Z");
    // Already sane → untouched by the WHERE guard.
    expect(after[`${URI}-3`]).toBe(OLD);
  });
});
