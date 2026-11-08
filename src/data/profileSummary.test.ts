import { expect, test } from "bun:test";
import { createTestDb, testKv } from "../test/db";
import { buildFollowMembershipQuery, getFollowCounts, getFollowDids } from "./profileSummary";

test("follow membership agrees with DISTINCT readers, including owned-only books and stable avatar ties", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    for (const did of ["a", "a", "b", "c", "inactive", "outsider"]) {
      sqlite
        .prepare(`INSERT INTO user_book (uri,cid,userDid,hiveId,title,authors,status,owned,createdAt,indexedAt)
        VALUES (?, 'cid', ?, 'bk_fixture', 'Book', 'Author', NULL, 1, '2026-01-01', '2026-01-01')`)
        .run(`at://fixture/book/${crypto.randomUUID()}`, did);
    }
    for (const [user, follows, active] of [
      ["me", "a", 1],
      ["me", "b", 1],
      ["me", "inactive", 0],
      ["me", "no-books", 1],
      ["a", "me", 1],
      ["c", "me", 1],
      ["inactive", "me", 0],
      ["no-books", "me", 1],
      ["outsider", "a", 1],
    ] as const) {
      sqlite
        .prepare(`INSERT INTO user_follows (userDid,followsDid,isActive,followedAt,syncedAt,lastSeenAt)
        VALUES (?,?,?,'2026-01-01','2026-01-01','2026-01-01')`)
        .run(user, follows, active);
    }
    const counts = await getFollowCounts({ db, kv: testKv(), did: "me" });
    expect(counts).toEqual({ followingCount: 2, followersCount: 2 });
    expect(await getFollowDids({ db, did: "me" })).toEqual({
      following: ["b", "a"],
      followers: ["c", "a"],
    });
    expect(await getFollowDids({ db, did: "me", limit: 1 })).toEqual({
      following: ["b"],
      followers: ["c"],
    });
    for (const direction of ["following", "followers"] as const) {
      const member = direction === "following" ? "followsDid" : "userDid";
      const owner = direction === "following" ? "userDid" : "followsDid";
      const legacy = await db
        .selectFrom("user_follows")
        .select(member)
        .where(owner, "=", "me")
        .where("isActive", "=", 1)
        .where(member, "in", db.selectFrom("user_book").select("userDid").distinct())
        .orderBy("followedAt", "desc")
        .orderBy(member, "desc")
        .execute();
      const query = buildFollowMembershipQuery({ db, did: "me", direction })
        .select(member)
        .orderBy("followedAt", "desc")
        .orderBy(member, "desc")
        .limit(50);
      expect(await query.execute()).toEqual(legacy);
      const compiled = query.compile();
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`)
        .all(...(compiled.parameters as never[]))
        .map((r) => (r as { detail: string }).detail)
        .join("\n");
      expect(plan).toMatch(/SEARCH user_book(?: EXISTS)? USING COVERING INDEX .*\(userDid=\?\)/);
      expect(plan).not.toContain("LIST SUBQUERY");
      expect(plan).not.toContain("SCAN user_book");
      expect(plan).not.toContain("SCAN user_follows");
      if (direction === "followers") {
        expect(plan).toContain("idx_user_follows_reverse_active");
        expect(plan).not.toContain("TEMP B-TREE");
      }
    }
    expect(await getFollowCounts({ db, kv: testKv(), did: "missing" })).toEqual({
      followingCount: 0,
      followersCount: 0,
    });
  } finally {
    await close();
  }
});
