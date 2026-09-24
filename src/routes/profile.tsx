/**
 * Profile and refresh-books routes.
 * Mount at / so paths are /profile, /profile/:handle, /profile/:handle/image, /refresh-books.
 */
import { resolveActorDid } from "../services/actor";
import { renderError } from "./errorPage";
import { Hono } from "hono";
import { endTime, startTime } from "hono/timing";

import type { AppEnv } from "../context";
import { Error as ErrorPage } from "../pages/error";
import { ProfilePage } from "../pages/profile";
import { ReadingStatsPage } from "../pages/readingStats";
import { getProfile, getProfiles } from "../services/getProfile";
import {
  getFollowCounts,
  getFollowDids,
  getGenreCounts,
  isBuzzer as isBuzzerCheck,
  isFollowing as isFollowingCheck,
  listRecentProgress,
} from "../data/profileSummary";
import { listAllUserBooks } from "../data/userShelves";
import { getReadingStatsForYear, isValidStatsYear } from "../data/readingStats";
import { refetchBooks } from "./lib";
import { getUserLists } from "../services/lists";

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
      // A confirmation payload for the re-sync, not a library listing.
      const books = await listAllUserBooks({
        db: c.get("ctx").db,
        userDid: agent.did,
        orderBy: "indexedAt",
        limit: 10,
      });
      return c.json(books);
    }
    return c.redirect("/home");
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
    const did = await resolveActorDid(c.get("ctx"), handle);
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
    if (!isValidStatsYear(year)) {
      c.status(400);
      return c.render(
        <ErrorPage
          message="Invalid year"
          description="Please choose a valid year for your reading stats."
          statusCode={400}
        />,
        { title: "Invalid year" },
      );
    }

    startTime(c, "resolveDid");
    const did = await resolveActorDid(c.get("ctx"), handle);
    endTime(c, "resolveDid");

    if (!did) {
      c.status(404);
      return c.render(
        <ErrorPage
          message="Profile not found"
          description="This profile does not exist or has no books on BookHive."
          statusCode={404}
        />,
        { title: "Profile Not Found" },
      );
    }

    startTime(c, "isBuzzer+profile+books");
    const [isBuzzer, profile, books] = await Promise.all([
      isBuzzerCheck({ db: c.get("ctx").db, did }),
      getProfile({ ctx: c.get("ctx"), did }),
      listAllUserBooks({ db: c.get("ctx").db, userDid: did, orderBy: "indexedAt" }),
    ]);
    endTime(c, "isBuzzer+profile+books");

    if (!isBuzzer) {
      c.status(404);
      return c.render(
        <ErrorPage
          message="No books yet"
          description="This user has no books on BookHive yet."
          statusCode={404}
        />,
        { title: "Reading stats" },
      );
    }

    const parsedBooks = books;

    const sessionAgent = await c.get("ctx").getSessionAgent();
    const isOwnProfile = sessionAgent?.did === did;

    startTime(c, "db_genre_stats");
    // One helper owns the year filter, genre aggregate, MIN_BOOKS_FOR_YEAR_STATS
    // fallback and available-years window, so this route, the OG card and XRPC agree.
    const { stats, allTimeStats, showYearInBooks, availableYears } = await getReadingStatsForYear({
      db: c.get("ctx").db,
      books: parsedBooks,
      year,
    });
    endTime(c, "db_genre_stats");

    // `private`: renders viewer-specific UI (isOwnProfile), so no shared/CDN cache.
    c.header("Cache-Control", "private, max-age=600, stale-while-revalidate=600");

    return c.render(
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
      />,
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
    const did = await resolveActorDid(c.get("ctx"), handle);
    endTime(c, "resolveDid");

    if (!did) {
      // Use renderError (not a bare c.render with no c.status()) so an
      // unresolvable handle answers 404, not a 200 a crawler or fetch() reads as success.
      return renderError(c, {
        status: 404,
        title: "Profile Not Found",
        message: `Profile ${handle} not found`,
        description: "This profile may not exist or has not logged any books on bookhive",
      });
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

    startTime(c, "isBuzzer+profile");
    const [isBuzzer, profile] = await Promise.all([
      isBuzzerCheck({ db: c.get("ctx").db, did }),
      getProfile({ ctx: c.get("ctx"), did }),
    ]);
    endTime(c, "isBuzzer+profile");

    startTime(c, "books+session");
    const [parsedBooks, sessionAgent] = await Promise.all([
      isBuzzer
        ? listAllUserBooks({ db: c.get("ctx").db, userDid: did, orderBy: "indexedAt" })
        : Promise.resolve([]),
      c.get("ctx").getSessionAgent(),
    ]);
    endTime(c, "books+session");

    startTime(c, "isFollowing");
    const isFollowing = await isFollowingCheck({
      db: c.get("ctx").db,
      viewerDid: sessionAgent?.did,
      targetDid: did,
    });
    endTime(c, "isFollowing");

    startTime(c, "followCounts");
    const { followingCount, followersCount } = await getFollowCounts({
      db: c.get("ctx").db,
      kv: c.get("ctx").kv,
      did,
    });
    endTime(c, "followCounts");

    startTime(c, "followingFollowers");
    const { following: followingDids, followers: followersDids } = await getFollowDids({
      db: c.get("ctx").db,
      did,
    });
    const [followingProfiles, followersProfiles] = await Promise.all([
      followingDids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids: followingDids }) : [],
      followersDids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids: followersDids }) : [],
    ]);
    endTime(c, "followingFollowers");

    startTime(c, "userLists");
    const userLists = await getUserLists({ db: c.get("ctx").db, userDid: did });
    endTime(c, "userLists");

    startTime(c, "genreStats");
    const genreStats =
      isBuzzer && parsedBooks.length > 0
        ? await getGenreCounts({ db: c.get("ctx").db, hiveIds: parsedBooks.map((b) => b.hiveId) })
        : [];
    endTime(c, "genreStats");

    startTime(c, "progressHistory");
    const isOwnProfile = sessionAgent?.did === did;
    const progressHistory =
      isOwnProfile && isBuzzer
        ? await listRecentProgress({ db: c.get("ctx").db, did, limit: 10 })
        : [];
    endTime(c, "progressHistory");

    // `private`: renders viewer-specific UI (follow button / isOwnProfile), so
    // no shared/CDN cache. Short TTL + SWR avoids recomputing on quick revisits.
    c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");

    return c.render(
      <ProfilePage
        isBuzzer={isBuzzer}
        handle={handle}
        did={did}
        books={parsedBooks}
        profile={profile}
        isFollowing={isFollowing}
        canFollow={Boolean(sessionAgent) && sessionAgent?.did !== did}
        isOwnProfile={isOwnProfile}
        followingCount={followingCount}
        followersCount={followersCount}
        followingProfiles={followingProfiles}
        followersProfiles={followersProfiles}
        genreStats={genreStats}
        userLists={userLists}
        progressHistory={progressHistory}
      />,
      {
        title: "BookHive | @" + handle,
        description: `@${handle}'s reading profile — ${parsedBooks.length} books read on BookHive`,
        image: `${new URL(c.req.url).origin}/og/profile/${handle}`,
        atTags: { author: did },
      },
    );
  });

export default app;
