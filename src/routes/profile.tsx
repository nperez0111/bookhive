/**
 * Profile and refresh-books routes.
 * Mount at / so paths are /profile, /profile/:handle, /profile/:handle/image, /refresh-books.
 */
import { isDid } from "@atcute/lexicons/syntax";
import { Fragment } from "hono/jsx";
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";

import { sql } from "kysely";
import type { AppEnv } from "../context";
import { BookFields } from "../db";
import { Error as ErrorPage } from "../pages/error";
import { Layout } from "../pages/layout";
import { ProfilePage } from "../pages/profile";
import { getProfile, getProfiles } from "../utils/getProfile";
import { hydrateUserBook } from "../utils/bookProgress";
import { refetchBooks } from "./lib";

const app = new Hono<AppEnv>()
  .get("/refresh-books", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to refresh books"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }
    await refetchBooks({ agent, ctx: c.get("ctx") });
    if (c.req.header()["accept"] === "application/json") {
      const books = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .selectAll()
        .where("userDid", "=", agent.did)
        .orderBy("indexedAt", "desc")
        .limit(10)
        .execute();
      return c.json(books);
    }
    return c.redirect("/");
  })
  .get("/profile", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to view your profile"
            statusCode={401}
          />
        </Layout>,
        401,
      );
    }
    const handle = await c.get("ctx").resolver.resolveDidToHandle(agent.did);
    return c.redirect(`/profile/${handle}`);
  })
  .get("/profile/:handle/image", async (c) => {
    const handle = c.req.param("handle");
    const did = isDid(handle)
      ? handle
      : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    const profile = await getProfile({ ctx: c.get("ctx"), did: did! });
    if (!profile || !profile.avatar) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Profile not found"
            description="The profile you are looking for does not exist"
            statusCode={404}
          />
        </Layout>,
        404,
      );
    }
    return c.redirect(`/images/w_500/${profile.avatar}`);
  })
  .get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");
    startTime(c, "resolveDid");
    const did = isDid(handle)
      ? handle
      : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    endTime(c, "resolveDid");

    if (!did) {
      return c.render(
        <Fragment>
          <h1>Profile {handle} not found</h1>
          <p>
            This profile may not exist or has not logged any books on bookhive
          </p>
        </Fragment>,
        { title: "Profile Not Found" },
      );
    }

    startTime(c, "isBuzzer");
    const isBuzzer = Boolean(
      await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select("userDid")
        .where("userDid", "=", did)
        .limit(1)
        .executeTakeFirst(),
    );
    endTime(c, "isBuzzer");

    startTime(c, "profile");
    const profile = await getProfile({ ctx: c.get("ctx"), did });
    endTime(c, "profile");

    startTime(c, "books");
    const books = isBuzzer
      ? await c
          .get("ctx")
          .db.selectFrom("user_book")
          .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .select(BookFields)
          .where("user_book.userDid", "=", did)
          .orderBy("user_book.indexedAt", "desc")
          .limit(10_000)
          .execute()
      : [];
    const parsedBooks = books.map((book) => hydrateUserBook(book));
    endTime(c, "books");

    startTime(c, "session");
    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isFollowing =
      sessionAgent && sessionAgent.did !== did
        ? Boolean(
            await c
              .get("ctx")
              .db.selectFrom("user_follows")
              .select(["followsDid"])
              .where("userDid", "=", sessionAgent.did)
              .where("followsDid", "=", did)
              .where("isActive", "=", 1)
              .executeTakeFirst(),
          )
        : undefined;
    endTime(c, "session");

    startTime(c, "followCounts");
    const [followingCountRes, followersCountRes] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("userDid", "=", did)
        .where("isActive", "=", 1)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("followsDid", "=", did)
        .where("isActive", "=", 1)
        .executeTakeFirst(),
    ]);
    const followingCount = Number(followingCountRes?.count ?? 0);
    const followersCount = Number(followersCountRes?.count ?? 0);
    endTime(c, "followCounts");

    startTime(c, "followingFollowers");
    const [followingRows, followersRows] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select("followsDid")
        .where("userDid", "=", did)
        .where("isActive", "=", 1)
        .orderBy("followedAt", "desc")
        .limit(50)
        .execute(),
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select("userDid")
        .where("followsDid", "=", did)
        .where("isActive", "=", 1)
        .orderBy("followedAt", "desc")
        .limit(50)
        .execute(),
    ]);
    const followingDids = followingRows.map((r) => r.followsDid);
    const followersDids = followersRows.map((r) => r.userDid);
    const [followingProfiles, followersProfiles] = await Promise.all([
      followingDids.length > 0
        ? getProfiles({ ctx: c.get("ctx"), dids: followingDids })
        : [],
      followersDids.length > 0
        ? getProfiles({ ctx: c.get("ctx"), dids: followersDids })
        : [],
    ]);
    endTime(c, "followingFollowers");

    startTime(c, "genreStats");
    let genreStats: { genre: string; count: number }[] = [];
    if (isBuzzer && parsedBooks.length > 0) {
      const hiveIds = parsedBooks.map((b) => b.hiveId);
      const rows = await c
        .get("ctx")
        .db.selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")])
        .where("hiveId", "in", hiveIds)
        .groupBy("genre")
        .orderBy(sql`COUNT(*)`, "desc")
        .limit(15)
        .execute();
      genreStats = rows.map((r) => ({
        genre: r.genre,
        count: Number(r.count),
      }));
    }
    endTime(c, "genreStats");

    return c.render(
      <ProfilePage
        isBuzzer={isBuzzer}
        handle={handle}
        did={did}
        books={parsedBooks}
        profile={profile}
        isFollowing={isFollowing}
        canFollow={Boolean(sessionAgent) && sessionAgent?.did !== did}
        isOwnProfile={sessionAgent?.did === did}
        followingCount={followingCount}
        followersCount={followersCount}
        followingProfiles={followingProfiles}
        followersProfiles={followersProfiles}
        genreStats={genreStats}
      />,
      {
        title: "BookHive | @" + handle,
        description: `@${handle}'s reading profile — ${parsedBooks.length} books read on BookHive`,
        image: profile?.avatar,
      },
    );
  });

export default app;
