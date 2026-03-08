import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { sql } from "kysely";
import { endTime, startTime } from "hono/timing";
import { getEmoji } from "./genreEmoji";
import { getTopAuthors } from "./authorDirectory";

function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}

export const Explore: FC = async () => {
  const c = useRequestContext();
  const db = c.get("ctx").db;

  startTime(c, "explore-genres");
  startTime(c, "explore-authors");

  const [genres, topAuthors] = await Promise.all([
    db
      .selectFrom("hive_book_genre")
      .select(["genre", sql<number>`COUNT(*)`.as("count")])
      .groupBy("genre")
      .orderBy(sql`COUNT(*)`, "desc")
      .limit(6)
      .execute()
      .then((r) => {
        endTime(c, "explore-genres");
        return r;
      }),
    getTopAuthors(db, 8).then((r) => {
      endTime(c, "explore-authors");
      return r;
    }),
  ]);

  return (
    <div class="bg-background -mx-4 -my-4 min-h-full px-4 py-6 lg:-mx-6 lg:-my-6 lg:px-6 lg:py-8">
      <div class="mx-auto max-w-5xl space-y-10">
        <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <a href="/" class="hover:text-foreground transition-colors">
            Home
          </a>
          <span aria-hidden="true">›</span>
          <span class="text-foreground font-medium">Explore</span>
        </nav>

        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">Explore</h1>
          <p class="text-muted-foreground mt-2 text-base">
            Discover your next read by genre or author.
          </p>
        </div>

        {/* Top Genres */}
        <section>
          <div class="mb-3 flex items-baseline justify-between">
            <h2 class="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
              Top Genres
            </h2>
            <a
              href="/explore/genres"
              class="text-primary hover:text-primary/80 text-sm transition-colors"
            >
              See all genres →
            </a>
          </div>
          <div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {genres.map((genre) => (
              <a
                href={`/explore/genres/${encodeURIComponent(genre.genre)}`}
                class="card group relative overflow-hidden p-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
                style={`--genre-name: genre-${genre.genre}`}
              >
                <span
                  class="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl opacity-[0.06] select-none"
                  aria-hidden="true"
                >
                  {getEmoji(genre.genre)}
                </span>
                <div class="relative">
                  <div class="text-xl font-bold tabular-nums text-primary/70 group-hover:text-primary">
                    {formatCount(genre.count)}
                  </div>
                  <p class="genre-name mt-1 truncate text-xs font-medium text-foreground group-hover:text-primary">
                    {genre.genre}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Top Authors */}
        <section>
          <div class="mb-3 flex items-baseline justify-between">
            <h2 class="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
              Top Authors
            </h2>
            <a
              href="/explore/authors"
              class="text-primary hover:text-primary/80 text-sm transition-colors"
            >
              See all authors →
            </a>
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {topAuthors.map((author) => (
              <a
                href={`/authors/${encodeURIComponent(author.author)}`}
                class="card group flex items-center gap-3 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
              >
                {author.thumbnail ? (
                  <img
                    src={author.thumbnail}
                    alt=""
                    class="h-16 w-12 shrink-0 rounded object-cover shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  <div class="bg-muted flex h-16 w-12 shrink-0 items-center justify-center rounded">
                    <span class="text-muted-foreground text-lg font-bold">
                      {author.author[0]?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                )}
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold leading-tight text-foreground group-hover:text-primary">
                    {author.author}
                  </p>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {formatCount(author.bookCount)} books
                  </p>
                  {author.avgRating && (
                    <p class="text-muted-foreground text-xs">★ {author.avgRating.toFixed(1)}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
