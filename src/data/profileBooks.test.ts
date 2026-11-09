import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { KyselyPlugin } from "kysely";
import type { AppEnv } from "../context";
import type { SessionClient } from "../auth/client";
import { BookFields, type Database } from "../db";
import { createTestDb, testContext } from "../test/db";
import { createXrpcRouter, type XrpcContext } from "../xrpc/router";
import { buildProfileBooksQuery, listProfileWireBooks } from "./profileBooks";

const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaaaa";
const friend = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbbbb";
const inactive = "did:plc:cccccccccccccccccccccccccc";
const viewer = "did:plc:dddddddddddddddddddddddddd";
const now = "2026-11-01T00:00:00.000Z";
let fixture: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  fixture = await createTestDb();
});
afterEach(async () => {
  await fixture.close();
});

function seed(count: number, owner = did) {
  const catalogue = fixture.sqlite.prepare(`INSERT OR IGNORE INTO hive_book
    (id,title,authors,source,createdAt,updatedAt,description,cover,thumbnail,rating,ratingsCount,rawTitle,meta)
    VALUES (?,'Catalogue title','Author','goodreads',?,?,?,NULL,'thumbnail',4,100,'unused raw title',?)`);
  const book = fixture.sqlite.prepare(`INSERT INTO user_book
    (uri,cid,userDid,hiveId,title,authors,createdAt,indexedAt,status,owned,review,stars,startedAt,finishedAt,bookProgress,previousReads)
    VALUES (?,'unused cid',?,?,?,'Author\tSecond author','2020-01-01T00:00:00.000Z',?,?,?, ?,8,?,?,?,?)`);
  const progress = JSON.stringify({ currentPage: 25, totalPages: 100, updatedAt: now });
  const history = JSON.stringify([
    { startedAt: "2024-01-01T00:00:00.000Z", finishedAt: "2024-02-01T00:00:00.000Z" },
  ]);
  for (let index = 0; index < count; index++) {
    const id = `bk_${index % 3}` as const;
    if (index % 3 !== 2)
      catalogue.run(
        id,
        now,
        now,
        "Full description 🐝\n".repeat(100),
        JSON.stringify({ authorBio: "unused metadata ".repeat(128) }),
      );
    book.run(
      `at://${owner}/buzz.bookhive.book/${String(index).padStart(5, "0")}`,
      owner,
      id,
      `User title ${index}`,
      index % 4 === 0 ? "2026-11-01T01:00:00+01:00" : now,
      index % 3 === 0 ? "finished" : index % 3 === 1 ? "reading" : null,
      index % 2,
      index % 2 === 0 ? "Full review 🌻\n".repeat(100) : null,
      index % 3 === 0 ? now : null,
      index % 3 === 0 ? now : null,
      index % 3 === 0 ? progress : index % 3 === 1 ? "[]" : "invalid JSON",
      index % 3 === 0 ? history : index % 3 === 1 ? "{}" : "invalid JSON",
    );
  }
}

function app(db: Database, sessionDid: string | null) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set(
      "ctx",
      testContext({
        db,
        getSessionAgent: async () => (sessionDid ? ({ did: sessionDid } as SessionClient) : null),
      }),
    );
    await next();
  });
  createXrpcRouter<XrpcContext>(
    app as never,
    {
      searchBooks: async () => [],
      ensureBookIdentifiersCurrent: async () => {},
      getProfile: async () => null,
    } as never,
  );
  return app;
}

test("100-book XRPC responses are byte-identical with the legacy wide projection for every viewer", async () => {
  seed(100);
  seed(60, friend);
  seed(5, inactive);
  fixture.sqlite
    .exec(`INSERT INTO user_follows (userDid,followsDid,followedAt,syncedAt,lastSeenAt,isActive) VALUES
    ('${did}','${friend}','${now}','${now}','${now}',1),
    ('${did}','${inactive}','${now}','${now}','${now}',0),
    ('${viewer}','${did}','${now}','${now}','${now}',1);
    INSERT INTO book_id_map (hiveId,isbn,isbn13,goodreadsId,updatedAt) VALUES ('bk_0','123456789X','1234567890123','123','${now}');
    INSERT INTO hive_book_genre (hiveId,genre) VALUES ('bk_0','Fantasy'),('bk_0','Fiction');`);
  const legacy = fixture.db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .toOperationNode();
  let legacyQueries = 0;
  const legacyProjection: KyselyPlugin = {
    transformQuery({ node }) {
      if (
        node.kind === "SelectQueryNode" &&
        JSON.stringify(node).includes('"name":"previousReads"')
      ) {
        legacyQueries++;
        return { ...node, selections: legacy.selections } as typeof legacy;
      }
      return node;
    },
    async transformResult({ result }) {
      return result;
    },
  };
  for (const sessionDid of [null, did, viewer]) {
    const url = `/xrpc/buzz.bookhive.getProfile?did=${did}`;
    const response = await app(fixture.db, sessionDid).request(url);
    const oldResponse = await app(fixture.db.withPlugin(legacyProjection), sessionDid).request(url);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(oldResponse.status).toBe(200);
    expect(text).toBe(await oldResponse.text());
    const output = JSON.parse(text);
    expect(output.books).toHaveLength(100);
    expect(output.friendActivity).toHaveLength(50);
    expect(output.friendActivity.every((row: { userDid: string }) => row.userDid === friend)).toBe(
      true,
    );
    expect(
      output.books.every(
        (row: { createdAt: string }) => row.createdAt === "2020-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(output.friendActivity[0].createdAt).not.toBe("2020-01-01T00:00:00.000Z");
    const detailed = output.books.find((row: { previousReads?: unknown }) => row.previousReads);
    expect(detailed.description).toBe("Full description 🐝\n".repeat(100));
    expect(detailed.review).toBe("Full review 🌻\n".repeat(100));
    expect(detailed.identifiers).toBeDefined();
    expect(detailed.genres).toEqual(["Fantasy", "Fiction"]);
    expect(output.profile.isFollowing).toBe(sessionDid === viewer ? true : undefined);
  }
  expect(legacyQueries).toBe(6);
});

test("wire reads retain ordering/limits while excluding only unused database fields", async () => {
  seed(1000);
  const options = { db: fixture.db, userDid: did, scope: "library" as const };
  const rows = await listProfileWireBooks(options);
  const full = await fixture.db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .where("user_book.userDid", "=", did)
    .orderBy("user_book.indexedAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(10_000)
    .execute();
  expect(rows).toHaveLength(1000);
  expect(full).toMatchObject(rows);
  for (const key of ["meta", "rawTitle", "ratingsCount", "cid", "uri"])
    expect(rows[0]).not.toHaveProperty(key);
  expect(rows.map((row) => row.title)).toEqual(full.map((row) => row.title));
  expect(buildProfileBooksQuery(options).compile().parameters).toContain(10_000);
  expect(buildProfileBooksQuery({ ...options, scope: "friends" }).compile().parameters).toContain(
    50,
  );
});
