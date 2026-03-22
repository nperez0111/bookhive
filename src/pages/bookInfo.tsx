import { formatDistanceToNow } from "date-fns";
import { type FC, Fragment } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { sql } from "kysely";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "../constants";
import { buildCrossPostText } from "../bsky/crossPost";
import { env } from "../env";
import type { HiveBook } from "../types";
import { buildAuthorLikePatterns } from "../utils/authorMatching";
import { hydrateUserBook } from "../utils/bookProgress";
import { getUserLists } from "../utils/lists";
import { getProfiles } from "../utils/getProfile";
import { CommentsSection } from "./comments";
import { StarDisplay } from "./components/cards";
import { BookTooltip, CoverImage, normalizeBookData } from "./components/BookCard";
import { Script } from "./utils/script";

// --- Recommendations (Who's Reading) ---

async function Recommendations({ book, did }: { book: HiveBook; did: string | null }) {
  const c = useRequestContext();
  startTime(c, "db_peer_books");
  const db = c.get("ctx").db;
  const [peerBooks, totalOthersCountResult] = await Promise.all([
    db
      .selectFrom("user_book")
      .selectAll()
      .where("hiveId", "==", book.id)
      .orderBy("indexedAt", "desc")
      .limit(101)
      .execute(),
    db
      .selectFrom("user_book")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("hiveId", "==", book.id)
      .$if(did !== null, (qb) => qb.where("userDid", "!=", did!))
      .executeTakeFirstOrThrow(),
  ]);
  endTime(c, "db_peer_books");

  const totalOthersCount = Number(totalOthersCountResult.count);

  startTime(c, "resolver_peer_profiles");
  const others = peerBooks.filter((r) => r.userDid !== did);
  const visible = others.slice(0, 100);
  const profiles = await getProfiles({
    ctx: c.get("ctx"),
    dids: visible.map((s) => s.userDid),
  });
  endTime(c, "resolver_peer_profiles");

  const profileMap = new Map<string, (typeof profiles)[number]>(profiles.map((p) => [p.did, p]));

  if (!peerBooks.length) {
    return (
      <div class="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-sm">
        Be the first to read this on BookHive!
      </div>
    );
  }

  if (peerBooks.every((related) => related.userDid === did)) {
    return (
      <div class="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-sm">
        You are the only one to have added this on BookHive, so far!
      </div>
    );
  }

  const remaining = Math.max(0, totalOthersCount - 100);

  return (
    <div class="flex flex-col gap-2">
      <div class="flex max-h-[500px] flex-col gap-2 overflow-y-auto">
        {visible.map((related) => {
          const profile = profileMap.get(related.userDid);
          const handle = profile?.handle || related.userDid;
          const avatar = profile?.avatar;
          return (
            <a
              key={related.userDid}
              href={`/profile/${handle}`}
              class="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
            >
              {avatar ? (
                <img
                  src={`/images/w_100/${avatar}`}
                  alt=""
                  class="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div class="h-8 w-8 shrink-0 rounded-full bg-muted" />
              )}
              <div class="min-w-0">
                <span class="text-primary font-medium">@{handle}</span>
                <span class="text-muted-foreground">
                  {" "}
                  -{" "}
                  {related.status && related.status in BOOK_STATUS_MAP
                    ? BOOK_STATUS_MAP[related.status as keyof typeof BOOK_STATUS_MAP]
                    : related.status || BOOK_STATUS_MAP[BOOK_STATUS.READING]}{" "}
                  {formatDistanceToNow(related.indexedAt, { addSuffix: true })}
                </span>
                {related.stars && (
                  <span class="text-muted-foreground"> - rated {related.stars / 2}</span>
                )}
                {related.review && <span class="text-muted-foreground"> - reviewed</span>}
              </div>
            </a>
          );
        })}
      </div>
      {remaining > 0 && (
        <p class="px-1 text-xs text-muted-foreground">
          + {remaining} more {remaining === 1 ? "person" : "people"}
        </p>
      )}
    </div>
  );
}

// --- Main Component ---

export const BookInfo: FC<{
  book: HiveBook;
  reviewId?: string;
}> = async ({ book, reviewId }) => {
  const c = useRequestContext();
  const origin = new URL(c.req.url).origin;
  startTime(c, "get_session");
  const did = (await c.get("ctx").getSessionAgent())?.did ?? null;
  endTime(c, "get_session");

  const firstAuthor = book.authors.split("\t")[0] ?? "";
  const patterns = firstAuthor ? buildAuthorLikePatterns(firstAuthor) : null;
  const authorCondition = patterns
    ? sql`(authors = ${patterns.exact} OR authors LIKE ${patterns.first} OR authors LIKE ${patterns.middle} OR authors LIKE ${patterns.last})`
    : sql`0`;

  // Run all independent queries in parallel
  startTime(c, "db_parallel_queries");
  const [rawUserBook, reviewsOfThisBook, userLists, bookOnShelves, userHandle, otherBooksByAuthor] =
    await Promise.all([
      // db_user_book
      did
        ? c
            .get("ctx")
            .db.selectFrom("user_book")
            .selectAll()
            .where("userDid", "==", did)
            .where("hiveId", "==", book.id)
            .executeTakeFirst()
        : Promise.resolve(undefined),
      // db_reviews_of_this_book
      c
        .get("ctx")
        .db.selectFrom("user_book")
        .select([
          "user_book.hiveId",
          "user_book.createdAt",
          "user_book.uri",
          "user_book.cid",
          "user_book.userDid",
          "user_book.review",
          "user_book.stars",
          (eb) =>
            eb
              .selectFrom("buzz")
              .select(sql<number>`count(*)`.as("commentCount"))
              .where("buzz.parentUri", "=", eb.ref("user_book.uri"))
              .as("commentCount"),
        ])
        .where("user_book.hiveId", "=", book.id)
        .where("user_book.review", "!=", "")
        .orderBy("user_book.createdAt", "desc")
        .limit(10_000)
        .execute(),
      // db_user_lists
      did
        ? getUserLists({ db: c.get("ctx").db, userDid: did })
        : Promise.resolve([] as Awaited<ReturnType<typeof getUserLists>>),
      // db_book_on_shelves
      did
        ? c
            .get("ctx")
            .db.selectFrom("book_list_item")
            .innerJoin("book_list", "book_list_item.listUri", "book_list.uri")
            .select([
              "book_list.uri",
              "book_list.name",
              "book_list.userDid",
              "book_list_item.uri as itemUri",
            ])
            .where("book_list_item.hiveId", "==", book.id)
            .execute()
        : Promise.resolve([] as { uri: string; name: string; userDid: string; itemUri: string }[]),
      // userHandle
      did
        ? c
            .get("ctx")
            .resolver.resolveDidToHandle(did)
            .catch(() => did)
        : Promise.resolve(null),
      // db_other_books_by_author
      firstAuthor
        ? c
            .get("ctx")
            .db.selectFrom("hive_book")
            .selectAll()
            .where("id", "!=", book.id)
            .where(authorCondition as any)
            .orderBy("ratingsCount", "desc")
            .orderBy("rating", "desc")
            .limit(6)
            .execute()
        : Promise.resolve([] as HiveBook[]),
    ]);
  endTime(c, "db_parallel_queries");
  const usersBook = rawUserBook ? hydrateUserBook(rawUserBook) : undefined;

  const genres: string[] = book.genres ? JSON.parse(book.genres) : [];
  const meta = book.meta ? JSON.parse(book.meta) : null;
  const seriesData = book.series ? JSON.parse(book.series) : null;
  const bookUrl = `${env.PUBLIC_URL}/books/${book.id}`;

  const shareHref = usersBook
    ? `https://bsky.app/intent/compose?text=${encodeURIComponent(
        buildCrossPostText({
          title: usersBook.title,
          authors: usersBook.authors,
          status: usersBook.status ?? undefined,
          stars: usersBook.stars ?? undefined,
          review: usersBook.review ?? undefined,
          bookUrl,
          genres,
        }).text,
      )}`
    : null;

  const genericShareHref = `https://bsky.app/intent/compose?text=${encodeURIComponent(`Check out "${book.title}" by ${firstAuthor} on BookHive \u{1F4DA} ${origin ? `${origin}/books/${book.id}` : ""}`)}`;

  // Publication details
  const pubDetails: string[] = [];
  if (meta?.publicationYear && meta.publicationYear > 0) pubDetails.push(meta.publicationYear);
  if (meta?.publisher) pubDetails.push(meta.publisher);
  if (meta?.language) pubDetails.push(meta.language);

  return (
    <div class="mx-auto max-w-4xl space-y-8">
      {/* ===== SECTION 1: Book Hero ===== */}
      <div class="card">
        <div class="card-body">
          <div class="flex flex-col gap-6 md:flex-row md:gap-8">
            {/* Cover */}
            <div class="mx-auto w-48 shrink-0 md:mx-0 md:w-52">
              <div class="relative m-0 grid cursor-default break-inside-avoid">
                <div class="relative">
                  <div class="absolute top-[1%] left-4 h-[96%] w-[90%] rounded-r-md border border-gray-400 bg-white shadow-[10px_40px_40px_-10px_rgba(0,0,0,0.12),inset_-2px_0_0_gray,inset_-3px_0_0_#dbdbdb,inset_-4px_0_0_white,inset_-5px_0_0_#dbdbdb,inset_-6px_0_0_white,inset_-7px_0_0_#dbdbdb,inset_-8px_0_0_white,inset_-9px_0_0_#dbdbdb]" />
                  <div class="relative -translate-x-[10px] scale-x-[0.94] -rotate-y-[15deg] transform cursor-pointer rounded-r-md leading-none shadow-[6px_6px_18px_-2px_rgba(0,0,0,0.2),24px_28px_40px_-6px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out perspective-[2000px] hover:translate-x-0 hover:scale-x-100 hover:rotate-y-0 hover:shadow-[6px_6px_12px_-1px_rgba(0,0,0,0.1),20px_14px_16px_-6px_rgba(0,0,0,0.1)]">
                    <img
                      src={`${book.cover || book.thumbnail}`}
                      alt={`Cover of ${book.title}`}
                      class="book-cover col-span-1 row-span-full aspect-2/3 w-full rounded-r-md object-cover"
                      style={`--book-cover-name: book-cover-${book.id}`}
                    />
                    <div class="absolute top-0 z-[5] ml-4 h-full w-5 border-l-2 border-black/5 bg-gradient-to-r from-white/20 to-transparent transition-all duration-500 group-hover:ml-[14px]" />
                    <div class="absolute top-0 right-0 z-[4] h-full w-[90%] rounded bg-gradient-to-r from-transparent to-white/20 opacity-10 transition-all duration-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Info */}
            <div class="flex-1">
              <h1
                class="book-title mb-1 text-2xl font-bold md:text-3xl dark:text-gray-100"
                style={`--book-title-name: book-title-${book.id}`}
              >
                {book.title}
              </h1>
              <p class="mb-3 text-lg text-muted-foreground">
                by{" "}
                {book.authors.split("\t").map((author, index, array) => (
                  <Fragment key={author}>
                    <a
                      href={`/authors/${encodeURIComponent(author)}`}
                      class="text-primary hover:text-primary/80 hover:underline"
                    >
                      {author}
                    </a>
                    {index < array.length - 1 && ", "}
                  </Fragment>
                ))}
              </p>

              {/* Rating display */}
              <div class="mb-4 flex items-center gap-2">
                <StarDisplay rating={(book.rating || 0) / 1000} />
                {book.rating && <span class="text-lg font-semibold">{book.rating / 1000}</span>}
                {book.ratingsCount && (
                  <span class="text-sm text-muted-foreground">
                    ({book.ratingsCount.toLocaleString()} ratings)
                  </span>
                )}
              </div>

              {/* === Action Row === */}
              <div class="mb-5 space-y-3">
                <div class="flex items-center gap-2">
                  {/* Status dropdown */}
                  {did && (
                    <div class="relative">
                      <form action="/books" method="post" id="status-form">
                        <input type="hidden" name="authors" value={book.authors} />
                        <input type="hidden" name="title" value={book.title} />
                        <input type="hidden" name="hiveId" value={book.id} />
                        {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
                        {usersBook?.stars && (
                          <input type="hidden" name="stars" value={String(usersBook.stars)} />
                        )}
                        {usersBook?.review && (
                          <input type="hidden" name="review" value={usersBook.review} />
                        )}
                        {usersBook?.owned ? <input type="hidden" name="owned" value="1" /> : null}
                        {usersBook?.startedAt ? (
                          <input type="hidden" name="startedAt" value={usersBook.startedAt} />
                        ) : (
                          <input type="hidden" name="startedAt" id="auto-started-at" value="" />
                        )}
                        {usersBook?.finishedAt ? (
                          <input type="hidden" name="finishedAt" value={usersBook.finishedAt} />
                        ) : (
                          <input type="hidden" name="finishedAt" id="auto-finished-at" value="" />
                        )}

                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded="false"
                          id="status-dropdown"
                          class={`peer cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus:ring-2 focus:ring-primary focus:outline-none ${
                            usersBook?.status
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "bg-accent text-accent-foreground hover:bg-accent/80"
                          }`}
                        >
                          <span class="flex items-center gap-1.5 capitalize">
                            <span>
                              {(usersBook?.status &&
                                (usersBook.status in BOOK_STATUS_MAP
                                  ? BOOK_STATUS_MAP[
                                      usersBook.status as keyof typeof BOOK_STATUS_MAP
                                    ]
                                  : usersBook.status)) ||
                                "Want to Read"}
                            </span>
                            <svg
                              class="h-4 w-4 opacity-70"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </span>
                        </button>

                        <div
                          role="listbox"
                          id="status-dropdown-menu"
                          class="invisible absolute z-10 mt-1 w-48 rounded-lg bg-card opacity-0 shadow-lg ring-1 ring-border transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100"
                        >
                          <div class="p-1">
                            {[
                              { value: BOOK_STATUS.FINISHED, label: "Read" },
                              { value: BOOK_STATUS.READING, label: "Reading" },
                              { value: BOOK_STATUS.WANTTOREAD, label: "Want to Read" },
                              { value: BOOK_STATUS.ABANDONED, label: "Abandoned" },
                            ].map((status) => (
                              <button
                                key={status.value}
                                type="submit"
                                role="option"
                                aria-selected={usersBook?.status === status.value}
                                name="status"
                                value={status.value}
                                class={`relative my-0.5 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                                  usersBook?.status === status.value
                                    ? "bg-primary text-primary-foreground"
                                    : "text-foreground hover:bg-muted"
                                }`}
                              >
                                <span class="block truncate">{status.label}</span>
                                {usersBook?.status === status.value && (
                                  <span
                                    class="absolute inset-y-0 right-2 flex items-center"
                                    aria-hidden="true"
                                  >
                                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                      <path
                                        fillRule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </form>

                      <Script
                        script={(document) => {
                          const dropdown = document.getElementById("status-dropdown")!;
                          const dropdownMenu = document.getElementById("status-dropdown-menu")!;
                          dropdown.addEventListener("click", () => {
                            dropdown.setAttribute(
                              "aria-expanded",
                              dropdown.getAttribute("aria-expanded") === "true" ? "false" : "true",
                            );
                          });
                          document.addEventListener("click", (e) => {
                            if (
                              dropdown.getAttribute("aria-expanded") === "true" &&
                              !dropdown.contains(e.target as any) &&
                              !dropdownMenu.contains(e.target as any)
                            ) {
                              dropdown.setAttribute("aria-expanded", "false");
                            }
                          });
                        }}
                      />
                    </div>
                  )}

                  {/* Owned toggle */}
                  {did && (
                    <form action="/books" method="post">
                      <input type="hidden" name="authors" value={book.authors} />
                      <input type="hidden" name="title" value={book.title} />
                      <input type="hidden" name="hiveId" value={book.id} />
                      {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
                      {usersBook?.status && (
                        <input type="hidden" name="status" value={usersBook.status} />
                      )}
                      {usersBook?.stars && (
                        <input type="hidden" name="stars" value={String(usersBook.stars)} />
                      )}
                      {usersBook?.review && (
                        <input type="hidden" name="review" value={usersBook.review} />
                      )}
                      {usersBook?.startedAt && (
                        <input type="hidden" name="startedAt" value={usersBook.startedAt} />
                      )}
                      {usersBook?.finishedAt && (
                        <input type="hidden" name="finishedAt" value={usersBook.finishedAt} />
                      )}
                      <button
                        type="submit"
                        name="owned"
                        value={usersBook?.owned ? "false" : "true"}
                        class={`cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition-colors focus:ring-2 focus:ring-primary focus:outline-none ${
                          usersBook?.owned
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "bg-accent text-accent-foreground hover:bg-accent/80"
                        }`}
                      >
                        <span class="flex items-center gap-1.5">
                          <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                          </svg>
                          {usersBook?.owned ? "Owned" : "Own"}
                        </span>
                      </button>
                    </form>
                  )}

                  {/* Share dropdown */}
                  <div class="relative ml-auto">
                    <button
                      type="button"
                      id="share-btn"
                      class="btn btn-ghost btn-sm"
                      aria-haspopup="true"
                      aria-expanded="false"
                    >
                      <svg
                        class="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                      Share
                    </button>
                    <div
                      id="share-menu"
                      class="invisible absolute right-0 z-10 mt-1 w-48 rounded-lg bg-card opacity-0 shadow-lg ring-1 ring-border transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100"
                    >
                      <div class="p-1">
                        <a
                          href={shareHref || genericShareHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <svg viewBox="0 0 24 24" class="h-4 w-4 fill-current" aria-hidden="true">
                            <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
                          </svg>
                          Share on Bluesky
                        </a>
                        <button
                          type="button"
                          id="copy-link-btn"
                          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                          data-book-url={`/books/${book.id}`}
                        >
                          <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                          <span id="copy-link-text">Copy link</span>
                        </button>
                        <button
                          type="button"
                          id="copy-rss-btn"
                          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                          data-rss-url={`/rss/book/${book.id}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            class="h-4 w-4 text-orange-500"
                          >
                            <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
                          </svg>
                          <span id="copy-rss-text">Copy RSS feed</span>
                        </button>
                      </div>
                    </div>
                    <Script
                      script={(document) => {
                        const btn = document.getElementById("share-btn")!;
                        const menu = document.getElementById("share-menu")!;
                        btn.addEventListener("click", () => {
                          const open = menu.classList.contains("invisible");
                          menu.classList.toggle("invisible", !open);
                          menu.classList.toggle("opacity-0", !open);
                          btn.setAttribute("aria-expanded", open ? "true" : "false");
                        });
                        document.addEventListener("click", (e) => {
                          if (!btn.contains(e.target as any) && !menu.contains(e.target as any)) {
                            menu.classList.add("invisible", "opacity-0");
                            btn.setAttribute("aria-expanded", "false");
                          }
                        });
                        const copyBtn = document.getElementById("copy-link-btn");
                        const copyText = document.getElementById("copy-link-text");
                        if (copyBtn && copyText) {
                          copyBtn.addEventListener("click", () => {
                            const url = copyBtn.getAttribute("data-book-url");
                            if (url) {
                              void navigator.clipboard.writeText(
                                (window.location.origin || "") + url,
                              );
                              copyText.textContent = "Copied!";
                              setTimeout(() => {
                                copyText.textContent = "Copy link";
                              }, 1500);
                            }
                          });
                        }
                        const rssBtn = document.getElementById("copy-rss-btn");
                        const rssText = document.getElementById("copy-rss-text");
                        if (rssBtn && rssText) {
                          rssBtn.addEventListener("click", () => {
                            const url = rssBtn.getAttribute("data-rss-url");
                            if (url) {
                              void navigator.clipboard.writeText(
                                (window.location.origin || "") + url,
                              );
                              rssText.textContent = "Copied!";
                              setTimeout(() => {
                                rssText.textContent = "Copy RSS feed";
                              }, 1500);
                            }
                          });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Timestamp for logged-in users */}
              {usersBook && (
                <p class="mb-4 text-sm text-muted-foreground">
                  {`${usersBook.finishedAt ? "Finished" : usersBook.startedAt ? "Started" : "Added"}: ${formatDistanceToNow(
                    usersBook.finishedAt ?? usersBook.startedAt ?? usersBook.createdAt,
                    { addSuffix: true },
                  )}`}
                </p>
              )}

              {/* Metadata row */}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {pubDetails.length > 0 && <span>{pubDetails.join(" \u00B7 ")}</span>}
                {meta?.numPages && <span>{meta.numPages} pages</span>}
                {seriesData && (
                  <span>
                    {seriesData.title}
                    {seriesData.position && ` (Book ${seriesData.position})`}
                  </span>
                )}
                {book.sourceUrl && (
                  <a
                    href={book.sourceUrl}
                    class="inline-flex items-center gap-1 text-primary hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {book.source}
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
                      <path d="m21 3-9 9" />
                      <path d="M15 3h6v6" />
                    </svg>
                  </a>
                )}
              </div>

              {/* Genre tags */}
              {genres.length > 0 && (
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {genres.map((genre: string, index: number) => (
                    <a
                      key={index}
                      href={`/genres/${encodeURIComponent(genre)}`}
                      class="genre-name rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
                      style={`--genre-name: genre-${genre}`}
                    >
                      {genre}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== SECTION 2: Description (clamped to 10 lines) ===== */}
      {book.description && (
        <div class="card">
          <div class="card-body">
            <h2 class="mb-3 text-lg font-semibold text-foreground">Description</h2>
            <input type="checkbox" id="desc-expand" class="peer hidden" />
            <div
              class="prose prose-sm dark:prose-invert max-w-none leading-relaxed text-gray-700 peer-checked:line-clamp-none dark:text-gray-300"
              style="display: -webkit-box; -webkit-line-clamp: 10; -webkit-box-orient: vertical; overflow: hidden;"
              id="desc-content"
              dangerouslySetInnerHTML={{ __html: book.description }}
            />
            <label
              htmlFor="desc-expand"
              id="desc-toggle"
              class="mt-2 hidden cursor-pointer text-sm font-medium text-primary hover:underline"
            >
              Show more
            </label>
            <Script
              script={(document) => {
                const content = document.getElementById("desc-content");
                const toggle = document.getElementById("desc-toggle");
                const checkbox = document.getElementById("desc-expand") as HTMLInputElement;
                if (!content || !toggle || !checkbox) return;
                // Check if content is actually clamped
                if (content.scrollHeight > content.clientHeight + 2) {
                  toggle.classList.remove("hidden");
                }
                checkbox.addEventListener("change", () => {
                  if (checkbox.checked) {
                    content.style.display = "block";
                    content.style.webkitLineClamp = "unset";
                    content.style.overflow = "visible";
                    toggle.textContent = "Show less";
                  } else {
                    content.style.display = "-webkit-box";
                    content.style.webkitLineClamp = "10";
                    content.style.overflow = "hidden";
                    toggle.textContent = "Show more";
                  }
                });
              }}
            />
          </div>
        </div>
      )}

      {/* ===== SECTION 3: Your Activity (auth'd, unified form) ===== */}
      {did && (
        <div class="card">
          <div class="card-body space-y-6">
            <h2 class="text-xl font-bold text-foreground">Your Activity</h2>

            <form action="/books" method="post" id="activity-form">
              {/* Hidden fields to preserve book identity */}
              <input type="hidden" name="authors" value={book.authors} />
              <input type="hidden" name="title" value={book.title} />
              <input type="hidden" name="hiveId" value={book.id} />
              {book.cover && <input type="hidden" name="coverImage" value={book.cover} />}
              {usersBook?.status && <input type="hidden" name="status" value={usersBook.status} />}
              <input
                type="hidden"
                name="stars"
                value={String(usersBook?.stars || 0)}
                id="rating-value"
              />

              <div class="space-y-6">
                {/* Star Rating */}
                <div>
                  <label class="mb-2 block text-sm font-semibold text-foreground">
                    Your Rating
                  </label>
                  <div
                    id="star-rating"
                    data-rating={usersBook?.stars}
                    class="flex cursor-pointer"
                  ></div>
                </div>

                {/* Review */}
                <div>
                  <label class="mb-2 block text-sm font-semibold text-foreground">
                    {usersBook?.review ? "Your Review" : "Write a Review"}
                  </label>
                  <div class="grid">
                    <textarea
                      class="col-start-1 row-start-1 min-h-[100px] w-full overflow-hidden rounded-md border-0 bg-card py-2 text-foreground shadow-xs ring-1 ring-border ring-inset placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:ring-inset sm:text-sm"
                      style={{ resize: "none", gridArea: "1 / 1 / 2 / 2" }}
                      placeholder="What did you think of this book?"
                      name="review"
                    >
                      {usersBook?.review || ""}
                    </textarea>
                    <div
                      class="invisible col-start-1 row-start-1 overflow-hidden px-3 py-2 break-words whitespace-pre-wrap"
                      aria-hidden="true"
                    >
                      {usersBook?.review || " "}
                    </div>
                  </div>
                </div>

                {/* Reading Progress (only when not finished) */}
                {usersBook?.status !== BOOK_STATUS.FINISHED && (
                  <div>
                    <label class="mb-2 block text-sm font-semibold text-foreground">
                      Reading Progress
                    </label>
                    {!!usersBook?.bookProgress?.percent && (
                      <div class="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          class="h-full rounded-full bg-primary transition-all"
                          style={`width: ${usersBook.bookProgress.percent}%`}
                        />
                      </div>
                    )}
                    <div class="flex items-center gap-2">
                      <label class="text-sm text-muted-foreground">Page</label>
                      <input
                        type="number"
                        id="progress-pages-current"
                        name="currentPage"
                        value={usersBook?.bookProgress?.currentPage ?? ""}
                        min={0}
                        class="w-20 rounded-md border border-border bg-amber-50 px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none dark:bg-amber-950/30 dark:text-amber-50"
                        placeholder="0"
                      />
                      <span class="text-muted-foreground">/</span>
                      <input
                        type="number"
                        id="progress-pages-total"
                        name="totalPages"
                        value={
                          usersBook?.bookProgress?.totalPages ??
                          (meta?.numPages ? meta.numPages : "")
                        }
                        min={1}
                        class="w-20 rounded-md border border-border bg-amber-50 px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none dark:bg-amber-950/30 dark:text-amber-50"
                        placeholder="Total"
                      />
                    </div>

                    {/* Expandable: chapters & percent */}
                    <details class="mt-3">
                      <summary class="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                        More options (chapters, manual %)
                      </summary>
                      <div class="mt-3 space-y-3">
                        <div class="flex items-center gap-2">
                          <label class="text-sm text-muted-foreground">Chapter</label>
                          <input
                            type="number"
                            id="progress-chapters-current"
                            name="currentChapter"
                            value={usersBook?.bookProgress?.currentChapter ?? ""}
                            min={1}
                            class="w-20 rounded-md border border-border bg-amber-50 px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none dark:bg-amber-950/30 dark:text-amber-50"
                            placeholder="0"
                          />
                          <span class="text-muted-foreground">/</span>
                          <input
                            type="number"
                            id="progress-chapters-total"
                            name="totalChapters"
                            value={usersBook?.bookProgress?.totalChapters ?? ""}
                            min={1}
                            class="w-20 rounded-md border border-border bg-amber-50 px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none dark:bg-amber-950/30 dark:text-amber-50"
                            placeholder="Total"
                          />
                        </div>
                        <div class="flex items-center gap-2">
                          <label class="text-sm text-muted-foreground">Percent</label>
                          <input
                            type="number"
                            id="progress-percent"
                            name="percent"
                            value={usersBook?.bookProgress?.percent ?? ""}
                            min={0}
                            max={100}
                            class="w-20 rounded-md border border-border bg-amber-50 px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none dark:bg-amber-950/30 dark:text-amber-50"
                            placeholder="Auto"
                          />
                          <span class="text-xs text-muted-foreground">
                            Auto-fills from pages or chapters
                          </span>
                        </div>
                      </div>
                    </details>
                  </div>
                )}

                {/* Reading Dates */}
                {usersBook && (
                  <div>
                    <label class="mb-2 block text-sm font-semibold text-foreground">
                      Reading Dates
                    </label>
                    <div class="flex flex-wrap items-center gap-4">
                      <div class="flex items-center gap-2">
                        <label class="text-sm text-muted-foreground">Started</label>
                        <input
                          type="date"
                          name="startedAt"
                          value={
                            usersBook.startedAt
                              ? new Date(usersBook.startedAt).toISOString().slice(0, 10)
                              : ""
                          }
                          class="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                      </div>
                      <div class="flex items-center gap-2">
                        <label class="text-sm text-muted-foreground">Finished</label>
                        <input
                          type="date"
                          name="finishedAt"
                          value={
                            usersBook.finishedAt
                              ? new Date(usersBook.finishedAt).toISOString().slice(0, 10)
                              : ""
                          }
                          class="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Save button */}
                <button type="submit" class="btn btn-primary w-full sm:w-auto">
                  Save
                </button>
              </div>
            </form>

            {/* Delete - separated, with confirmation */}
            {usersBook && (
              <div class="border-t border-border pt-4">
                <button
                  type="button"
                  id="delete-book-btn"
                  class="cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove from library
                </button>
                <dialog
                  id="delete-book-dialog"
                  class="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
                >
                  <h3 class="mb-2 text-lg font-semibold">Remove book?</h3>
                  <p class="mb-4 text-sm text-muted-foreground">
                    This will remove "{book.title}" from your library. This cannot be undone.
                  </p>
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onclick="this.closest('dialog').close()"
                    >
                      Cancel
                    </button>
                    <form action={`/books/${book.id}`} method="post" class="inline">
                      <input type="hidden" name="_method" value="DELETE" />
                      <button type="submit" class="btn btn-destructive">
                        Remove
                      </button>
                    </form>
                  </div>
                </dialog>
                <Script
                  script={(document) => {
                    const btn = document.getElementById("delete-book-btn");
                    const dialog = document.getElementById(
                      "delete-book-dialog",
                    ) as HTMLDialogElement;
                    btn?.addEventListener("click", () => dialog?.showModal());
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress auto-calc script */}
      {did && (
        <Script
          script={(document) => {
            const pageCurrent = document.getElementById(
              "progress-pages-current",
            ) as HTMLInputElement;
            const pageTotal = document.getElementById("progress-pages-total") as HTMLInputElement;
            const chapterCurrent = document.getElementById(
              "progress-chapters-current",
            ) as HTMLInputElement;
            const chapterTotal = document.getElementById(
              "progress-chapters-total",
            ) as HTMLInputElement;
            const percentInput = document.getElementById("progress-percent") as HTMLInputElement;
            function parseNumber(value: string | null) {
              const parsed = Number(value);
              return Number.isFinite(parsed) ? parsed : null;
            }
            function updatePercent() {
              if (!percentInput) return;
              const currentPage = parseNumber(pageCurrent?.value);
              const totalPages = parseNumber(pageTotal?.value);
              const currentChapter = parseNumber(chapterCurrent?.value);
              const totalChapters = parseNumber(chapterTotal?.value);
              let percent = null;
              if (currentPage !== null && totalPages && totalPages > 0) {
                percent = Math.min(100, Math.max(0, Math.round((currentPage / totalPages) * 100)));
              } else if (currentChapter !== null && totalChapters && totalChapters > 0) {
                percent = Math.min(
                  100,
                  Math.max(0, Math.round((currentChapter / totalChapters) * 100)),
                );
              }
              if (percent !== null) {
                percentInput.value = percent.toString();
              }
              // Update progress bar
              const bar = document.querySelector("[data-progress-bar]") as HTMLElement;
              if (bar && percent !== null) {
                bar.style.width = `${percent}%`;
              }
            }
            [pageCurrent, pageTotal, chapterCurrent, chapterTotal].forEach((input) => {
              input?.addEventListener("input", updatePercent);
            });
          }}
        />
      )}

      {/* ===== SECTION 4: About the Author ===== */}
      {(meta?.authorBio || otherBooksByAuthor.length > 0 || meta?.secondaryAuthors?.length > 0) && (
        <div class="card">
          <div class="card-body">
            <h2 class="mb-3 text-lg font-semibold text-foreground">
              About{" "}
              <a
                href={`/authors/${encodeURIComponent(firstAuthor)}`}
                class="text-primary hover:text-primary/80 hover:underline"
              >
                {firstAuthor}
              </a>
            </h2>
            <div class="space-y-4">
              {meta?.authorBio && (
                <>
                  <input type="checkbox" id="author-expand" class="peer hidden" />
                  <div
                    id="author-bio-content"
                    class="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-muted-foreground"
                    style="display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;"
                    dangerouslySetInnerHTML={{ __html: meta.authorBio }}
                  />
                  <label
                    htmlFor="author-expand"
                    id="author-bio-toggle"
                    class="hidden cursor-pointer text-sm font-medium text-primary hover:underline"
                  >
                    Show more
                  </label>
                  <Script
                    script={(document) => {
                      const content = document.getElementById("author-bio-content");
                      const toggle = document.getElementById("author-bio-toggle");
                      const checkbox = document.getElementById("author-expand") as HTMLInputElement;
                      if (!content || !toggle || !checkbox) return;
                      if (content.scrollHeight > content.clientHeight + 2) {
                        toggle.classList.remove("hidden");
                      }
                      checkbox.addEventListener("change", () => {
                        if (checkbox.checked) {
                          content.style.display = "block";
                          content.style.webkitLineClamp = "unset";
                          content.style.overflow = "visible";
                          toggle.textContent = "Show less";
                        } else {
                          content.style.display = "-webkit-box";
                          content.style.webkitLineClamp = "5";
                          content.style.overflow = "hidden";
                          toggle.textContent = "Show more";
                        }
                      });
                    }}
                  />
                </>
              )}
              {meta?.secondaryAuthors?.length > 0 && (
                <div>
                  <h4 class="mb-1 text-sm font-semibold text-muted-foreground">
                    Additional Authors
                  </h4>
                  <p class="text-sm text-muted-foreground">
                    {meta.secondaryAuthors.map((author: any, index: number) => (
                      <span key={index}>
                        {author.name}
                        {index < meta.secondaryAuthors.length - 1 && ", "}
                      </span>
                    ))}
                  </p>
                </div>
              )}
              {otherBooksByAuthor.length > 0 && (
                <div class="mt-6">
                  <h4 class="mb-2 text-sm font-semibold text-foreground">Also by this author</h4>
                  <div class="flex flex-wrap gap-3 pb-2">
                    {otherBooksByAuthor.slice(0, 5).map((other) => {
                      const bookData = normalizeBookData(other);
                      return (
                        <div key={other.id} class="group relative shrink-0">
                          <BookTooltip book={bookData} position="bottom" />
                          <a
                            href={`/books/${other.id}`}
                            class="block overflow-hidden rounded-lg transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-lg"
                          >
                            <CoverImage book={bookData} class="h-28 w-20 object-cover" />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== SECTION 5: Community ===== */}
      <div class="grid gap-6 md:grid-cols-2">
        {/* Who's Reading */}
        <div class="card">
          <div class="card-header">
            <h3 class="text-lg font-semibold text-foreground">Who's Reading This</h3>
          </div>
          <div class="card-body">
            <Recommendations book={book} did={did} />
          </div>
        </div>

        {/* Shelves */}
        <div class="card">
          <div class="card-header">
            <h3 class="text-lg font-semibold text-foreground">Shelves</h3>
          </div>
          <div class="card-body space-y-3">
            {/* Other users' shelves */}
            {bookOnShelves.filter((s) => s.userDid !== did).length > 0 && (
              <div class="flex flex-col gap-1">
                {bookOnShelves
                  .filter((s) => s.userDid !== did)
                  .map((shelf) => {
                    const rkey = shelf.uri.split("/").at(-1)!;
                    return (
                      <a
                        key={shelf.uri}
                        href={`/shelves/${shelf.userDid}/${rkey}`}
                        class="text-sm text-primary hover:underline"
                      >
                        {shelf.name}
                      </a>
                    );
                  })}
              </div>
            )}

            {/* Your shelves */}
            {did && bookOnShelves.filter((s) => s.userDid === did).length > 0 && (
              <div class="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  On your shelves
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {bookOnShelves
                    .filter((s) => s.userDid === did)
                    .map((shelf) => {
                      const rkey = shelf.uri.split("/").at(-1)!;
                      return (
                        <div key={shelf.uri} class="flex items-center gap-0.5">
                          <a
                            href={`/shelves/${userHandle}/${rkey}`}
                            class="badge text-xs hover:bg-primary hover:text-primary-foreground"
                          >
                            {shelf.name}
                          </a>
                          <form
                            method="post"
                            action={`/shelves/${userHandle}/${rkey}/remove`}
                            class="inline"
                          >
                            <input type="hidden" name="itemUri" value={shelf.itemUri} />
                            <input type="hidden" name="returnTo" value={`/books/${book.id}`} />
                            <button
                              type="submit"
                              title={`Remove from ${shelf.name}`}
                              class="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                class="h-3 w-3"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                              >
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </form>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Add to shelf */}
            {did &&
              userLists.length > 0 &&
              (() => {
                const shelvesWithBook = new Set(
                  bookOnShelves.filter((s) => s.userDid === did).map((s) => s.uri),
                );
                const availableShelves = userLists.filter((l) => !shelvesWithBook.has(l.uri));
                if (availableShelves.length === 0) return null;
                return (
                  <div class="relative">
                    <form method="post" action="/shelves/add">
                      <input type="hidden" name="hiveId" value={book.id} />
                      <button
                        type="button"
                        aria-haspopup="listbox"
                        aria-expanded="false"
                        id="add-to-shelf-btn"
                        class="peer w-full cursor-pointer rounded-md bg-card px-3 py-2 text-left text-sm font-medium text-foreground shadow-sm ring-1 ring-border ring-inset hover:bg-muted focus:ring-2 focus:ring-primary focus:outline-none"
                      >
                        <span class="flex items-center justify-between">
                          <span>Add to shelf...</span>
                          <svg
                            class="h-4 w-4 text-gray-400"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      </button>
                      <div
                        role="listbox"
                        id="add-to-shelf-menu"
                        class="invisible absolute z-10 mt-1 w-full rounded-md bg-card opacity-0 shadow-lg ring-1 ring-border transition-all duration-100 ease-in-out peer-aria-expanded:visible peer-aria-expanded:opacity-100"
                      >
                        <div class="p-1">
                          {availableShelves.map((list) => {
                            const rkey = list.uri.split("/").at(-1)!;
                            return (
                              <button
                                key={list.uri}
                                type="submit"
                                role="option"
                                name="shelfPath"
                                value={`${userHandle}/${rkey}`}
                                class="relative my-0.5 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                              >
                                {list.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </form>
                    <Script
                      script={(document) => {
                        const btn = document.getElementById("add-to-shelf-btn");
                        const menu = document.getElementById("add-to-shelf-menu");
                        if (!btn || !menu) return;
                        btn.addEventListener("click", () => {
                          btn.setAttribute(
                            "aria-expanded",
                            btn.getAttribute("aria-expanded") === "true" ? "false" : "true",
                          );
                        });
                        document.addEventListener("click", (e) => {
                          if (
                            btn.getAttribute("aria-expanded") === "true" &&
                            !btn.contains(e.target as any) &&
                            !menu.contains(e.target as any)
                          ) {
                            btn.setAttribute("aria-expanded", "false");
                          }
                        });
                      }}
                    />
                  </div>
                );
              })()}

            {/* Empty state */}
            {bookOnShelves.length === 0 && !did && (
              <p class="text-sm text-muted-foreground">No shelves yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* ===== SECTION 6: Reviews (always visible) ===== */}
      <div>
        <CommentsSection book={book} did={did} reviewId={reviewId}>
          <h2 class="mb-5 text-2xl font-bold text-foreground">
            Reviews{reviewsOfThisBook.length > 0 && ` (${reviewsOfThisBook.length})`}
          </h2>
          {reviewsOfThisBook.length === 0 && (
            <p class="mb-4 text-sm text-muted-foreground">
              No reviews yet.
              {did ? " Be the first to share your thoughts!" : " Log in to write a review."}
            </p>
          )}
        </CommentsSection>
      </div>
    </div>
  );
};
