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
import { ReadingStatsPage } from "../pages/readingStats";
import { getProfile, getProfiles } from "../utils/getProfile";
import { hydrateUserBook } from "../utils/bookProgress";
import {
  computeReadingStats,
  filterFinishedBooksAllTime,
  filterFinishedBooksByYear,
  MIN_BOOKS_FOR_YEAR_STATS,
} from "../utils/readingStats";
import { refetchBooks } from "./lib";
import { getUserLists } from "../utils/lists";
import { readThroughCache } from "../utils/readThroughCache";

const app = new Hono<AppEnv>()
  .get("/refresh-books", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      c.status(401);
      return c.render(
        <ErrorPage
          message="Invalid Session"
          description="Login to refresh books"
          statusCode={401}
        />,
        { title: "Unauthorized" },
      );
    }
    startTime(c, "refetch_books");
    await refetchBooks({ agent, ctx: c.get("ctx") });
    endTime(c, "refetch_books");
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
      c.status(401);
      return c.render(
        <ErrorPage
          message="Invalid Session"
          description="Login to view your profile"
          statusCode={401}
        />,
        { title: "Unauthorized" },
      );
    }
    const handle = await c.get("ctx").resolver.resolveDidToHandle(agent.did);
    return c.redirect(`/profile/${handle}`);
  })
  .get("/profile/:handle/image", async (c) => {
    const handle = c.req.param("handle");
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    const profile = await getProfile({ ctx: c.get("ctx"), did: did! });
    if (!profile || !profile.avatar) {
      c.status(404);
      return c.render(
        <ErrorPage
          message="Profile not found"
          description="The profile you are looking for does not exist"
          statusCode={404}
        />,
        { title: "Profile Not Found" },
      );
    }
    return c.redirect(profile.avatar);
  })
  .get("/profile/:handle/stats", async (c) => {
    const year = new Date().getFullYear();
    const handle = c.req.param("handle");
    return c.redirect(`/profile/${handle}/stats/${year}`);
  })
  .get("/profile/:handle/stats/:year", async (c) => {
    const handle = c.req.param("handle");
    const yearParam = c.req.param("year");
    const year = parseInt(yearParam, 10);
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      c.status(400);
      return c.render(
        <Layout>
          <ErrorPage
            message="Invalid year"
            description="Please choose a valid year for your reading stats."
            statusCode={400}
          />
        </Layout>,
        { title: "Invalid year" },
      );
    }

    startTime(c, "resolveDid");
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    endTime(c, "resolveDid");

    if (!did) {
      c.status(404);
      return c.render(
        <Layout>
          <ErrorPage
            message="Profile not found"
            description="This profile does not exist or has no books on BookHive."
            statusCode={404}
          />
        </Layout>,
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

    if (!isBuzzer) {
      c.status(404);
      return c.render(
        <Layout>
          <ErrorPage
            message="No books yet"
            description="This user has no books on BookHive yet."
            statusCode={404}
          />
        </Layout>,
        { title: "Reading stats" },
      );
    }

    startTime(c, "profile");
    const profile = await getProfile({ ctx: c.get("ctx"), did });
    endTime(c, "profile");

    startTime(c, "books");
    const books = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where("user_book.userDid", "=", did)
      .orderBy("user_book.indexedAt", "desc")
      .limit(10_000)
      .execute();
    const parsedBooks = books.map((book) => hydrateUserBook(book));
    endTime(c, "books");

    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isOwnProfile = sessionAgent?.did === did;

    const finishedInYear = filterFinishedBooksByYear(parsedBooks, year);
    const showYearInBooks = finishedInYear.length >= MIN_BOOKS_FOR_YEAR_STATS;

    startTime(c, "db_genre_stats_year");
    let genreStatsForYear: { genre: string; count: number }[] = [];
    if (finishedInYear.length > 0) {
      const hiveIds = finishedInYear.map((b) => b.hiveId);
      const rows = await c
        .get("ctx")
        .db.selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")])
        .where("hiveId", "in", hiveIds)
        .groupBy("genre")
        .orderBy(sql`COUNT(*)`, "desc")
        .limit(15)
        .execute();
      genreStatsForYear = rows.map((r) => ({
        genre: r.genre,
        count: Number(r.count),
      }));
    }
    endTime(c, "db_genre_stats_year");

    const stats = computeReadingStats(finishedInYear, genreStatsForYear);

    let allTimeStats: ReturnType<typeof computeReadingStats> | undefined;
    let availableYears: number[] = [];
    startTime(c, "db_genre_stats_alltime");
    if (!showYearInBooks && year != null) {
      const allFinished = filterFinishedBooksAllTime(parsedBooks);
      const allHiveIds = allFinished.map((b) => b.hiveId);
      let allTimeGenreStats: { genre: string; count: number }[] = [];
      if (allHiveIds.length > 0) {
        const rows = await c
          .get("ctx")
          .db.selectFrom("hive_book_genre")
          .select(["genre", sql<number>`COUNT(*)`.as("count")])
          .where("hiveId", "in", allHiveIds)
          .groupBy("genre")
          .orderBy(sql`COUNT(*)`, "desc")
          .limit(15)
          .execute();
        allTimeGenreStats = rows.map((r) => ({
          genre: r.genre,
          count: Number(r.count),
        }));
      }
      allTimeStats = computeReadingStats(allFinished, allTimeGenreStats);
    }
    endTime(c, "db_genre_stats_alltime");

    const finishedAllTime = filterFinishedBooksAllTime(parsedBooks);
    const yearSet = new Set(
      finishedAllTime
        .map((b) => (b.finishedAt ? new Date(b.finishedAt).getFullYear() : 0))
        .filter((y) => y >= 2000 && y <= 2100),
    );
    const currentYear = new Date().getFullYear();
    if (!yearSet.has(currentYear)) yearSet.add(currentYear);
    availableYears = [...yearSet].sort((a, b) => b - a);

    return c.render(
      <Layout>
        <ReadingStatsPage
          handle={handle}
          did={did}
          year={year}
          stats={stats}
          profile={profile}
          isOwnProfile={isOwnProfile}
          availableYears={availableYears}
          books={parsedBooks}
          allTimeStats={allTimeStats}
          showYearInBooks={showYearInBooks}
        />
      </Layout>,
      {
        title: `BookHive | @${handle}'s ${year} in Books`,
        description: `@${handle}'s reading stats for ${year} — ${stats.booksCount} books read on BookHive`,
        image: `${new URL(c.req.url).origin}/og/profile/${handle}/stats/${year}`,
      },
    );
  })
  .get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");
    const forceRefresh = c.req.query("force-refresh") === "true";

    startTime(c, "resolveDid");
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    endTime(c, "resolveDid");

    if (!did) {
      return c.render(
        <Fragment>
          <h1>Profile {handle} not found</h1>
          <p>This profile may not exist or has not logged any books on bookhive</p>
        </Fragment>,
        { title: "Profile Not Found" },
      );
    }

    if (forceRefresh) {
      const agent = await c.get("ctx").getSessionAgent();
      if (agent?.did === did) {
        startTime(c, "force_refetch_books");
        await refetchBooks({ agent, ctx: c.get("ctx") });
        endTime(c, "force_refetch_books");
        return c.redirect(`/profile/${handle}`);
      }
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

    // DIDs that have at least one book on BookHive (for following/followers filtering)
    const buzzersSubquery = c.get("ctx").db.selectFrom("user_book").select("userDid").distinct();

    startTime(c, "followCounts");
    const { followingCount, followersCount } = await readThroughCache<{
      followingCount: number;
      followersCount: number;
    }>(
      c.get("ctx").kv as import("unstorage").Storage<{
        followingCount: number;
        followersCount: number;
      }>,
      `followCounts:${did}`,
      async () => {
        const [followingCountRes, followersCountRes] = await Promise.all([
          c
            .get("ctx")
            .db.selectFrom("user_follows")
            .select((eb) => eb.fn.countAll().as("count"))
            .where("userDid", "=", did)
            .where("isActive", "=", 1)
            .where("followsDid", "in", buzzersSubquery)
            .executeTakeFirst(),
          c
            .get("ctx")
            .db.selectFrom("user_follows")
            .select((eb) => eb.fn.countAll().as("count"))
            .where("followsDid", "=", did)
            .where("isActive", "=", 1)
            .where("userDid", "in", buzzersSubquery)
            .executeTakeFirst(),
        ]);
        return {
          followingCount: Number(followingCountRes?.count ?? 0),
          followersCount: Number(followersCountRes?.count ?? 0),
        };
      },
      { followingCount: 0, followersCount: 0 },
      { ttl: 300_000 },
    );
    endTime(c, "followCounts");

    startTime(c, "followingFollowers");
    const [followingRows, followersRows] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select("followsDid")
        .where("userDid", "=", did)
        .where("isActive", "=", 1)
        .where("followsDid", "in", buzzersSubquery)
        .orderBy("followedAt", "desc")
        .limit(50)
        .execute(),
      c
        .get("ctx")
        .db.selectFrom("user_follows")
        .select("userDid")
        .where("followsDid", "=", did)
        .where("isActive", "=", 1)
        .where("userDid", "in", buzzersSubquery)
        .orderBy("followedAt", "desc")
        .limit(50)
        .execute(),
    ]);
    const followingDids = followingRows.map((r) => r.followsDid);
    const followersDids = followersRows.map((r) => r.userDid);
    const [followingProfiles, followersProfiles] = await Promise.all([
      followingDids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids: followingDids }) : [],
      followersDids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids: followersDids }) : [],
    ]);
    endTime(c, "followingFollowers");

    startTime(c, "userLists");
    const userLists = await getUserLists({ db: c.get("ctx").db, userDid: did });
    endTime(c, "userLists");

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
        .limit(10)
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
        userLists={userLists}
      />,
      {
        title: "BookHive | @" + handle,
        description: `@${handle}'s reading profile — ${parsedBooks.length} books read on BookHive`,
        image: `${new URL(c.req.url).origin}/og/profile/${handle}`,
      },
    );
  });

export default app;
