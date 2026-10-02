import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { SessionClient } from "../auth/client";
import type { Database } from "../db";
import { createTestDb } from "../test/db";
import { followUser, unfollowUser } from "./followGraph";

const USER = "did:plc:reader";
const TARGET = "did:plc:author";

describe("follow PDS and local mirror", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await db
      .insertInto("user_follows")
      .values({
        userDid: USER,
        followsDid: TARGET,
        followedAt: "2026-01-01T00:00:00.000Z",
        syncedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        isActive: 1,
      })
      .execute();
  });

  afterEach(async () => close());

  const agentWith = (get: ReturnType<typeof mock>, post = mock()) =>
    ({ did: USER, get, post }) as unknown as SessionClient;

  const isActive = async () =>
    (
      await db
        .selectFrom("user_follows")
        .select("isActive")
        .where("userDid", "=", USER)
        .where("followsDid", "=", TARGET)
        .executeTakeFirstOrThrow()
    ).isActive;

  it("leaves the mirror active when the bounded scan has more pages", async () => {
    const get = mock(async () => ({ ok: true, data: { records: [{}], cursor: "next" } }));
    const post = mock();
    const result = await unfollowUser({ db, agent: agentWith(get, post), targetDid: TARGET });

    expect(result).toEqual({ ok: false, message: "Could not finish listing follows" });
    expect(get).toHaveBeenCalledTimes(50);
    expect(post).not.toHaveBeenCalled();
    expect(await isActive()).toBe(1);
  });

  it("clears the mirror only when the final page confirms absence", async () => {
    const get = mock(async () => ({ ok: true, data: { records: [] } }));
    const result = await unfollowUser({ db, agent: agentWith(get), targetDid: TARGET });

    expect(result).toEqual({ ok: true, alreadyGone: true });
    expect(await isActive()).toBe(0);
  });

  it("finds the follow on a later page and deletes it remotely first", async () => {
    const get = mock()
      .mockResolvedValueOnce({ ok: true, data: { records: [{}], cursor: "next" } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [
            { uri: `at://${USER}/app.bsky.graph.follow/3kabc`, value: { subject: TARGET } },
          ],
        },
      });
    const post = mock(async (_name: string, _options: unknown) => ({ ok: true }));
    const result = await unfollowUser({ db, agent: agentWith(get, post), targetDid: TARGET });

    expect(result).toEqual({ ok: true });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      input: { writes: [{ $type: "com.atproto.repo.applyWrites#delete", rkey: "3kabc" }] },
    });
    expect(await isActive()).toBe(0);
  });

  it("returns a failure and preserves the mirror when the PDS request throws", async () => {
    const get = mock(async () => {
      throw new Error("PDS unavailable");
    });
    const result = await unfollowUser({ db, agent: agentWith(get), targetDid: TARGET });

    expect(result).toEqual({ ok: false, message: "Failed to unfollow user: PDS unavailable" });
    expect(await isActive()).toBe(1);
  });

  it("returns a failure when the follow write throws", async () => {
    const post = mock(async () => {
      throw new Error("PDS unavailable");
    });
    const result = await followUser({ db, agent: agentWith(mock(), post), targetDid: TARGET });

    expect(result).toEqual({ ok: false, message: "Failed to follow user: PDS unavailable" });
    expect(await isActive()).toBe(1);
  });
});
