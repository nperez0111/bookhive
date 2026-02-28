import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { sql } from "kysely";
import { endTime, startTime } from "hono/timing";

interface GenreWithCount {
  genre: string;
  count: number;
}

function formatCount(count: number): string {
  if (count < 10) {
    return `${count}`;
  }

  if (count < 100) {
    return `${Math.floor(count / 10) * 10}+`;
  }

  if (count >= 1000) {
    return `${Math.floor(count / 1000)}k+`;
  }
  return `${Math.floor(count / 100) * 100}+`;
}

export const GenresDirectory: FC = async () => {
  const c = useRequestContext();

  startTime(c, "genres-query");
  const genres: GenreWithCount[] = (
    await c
      .get("ctx")
      .db.selectFrom("hive_book_genre")
      .select(["genre", sql<number>`COUNT(*)`.as("count")])
      .groupBy("genre")
      .orderBy(sql`COUNT(*)`, "desc")
      .execute()
  ).filter((g: GenreWithCount) => g.count > 10);
  endTime(c, "genres-query");

  return (
    <div class="space-y-6">
      <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
        <a href="/" class="hover:text-foreground transition-colors">Home</a>
        <span aria-hidden="true">›</span>
        <span class="text-foreground font-medium">Genres</span>
      </nav>

      <div class="flex flex-col gap-2">
        <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
          Explore Genres
        </h1>
        <p class="text-muted-foreground mt-2 text-base">
          Discover books by genre. Click on any genre to see all books in that
          category.
        </p>

        <div class="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {genres.map((genre) => (
            <a
              href={`/genres/${encodeURIComponent(genre.genre)}`}
              class="card group relative transition-colors hover:border-primary/50"
              style={`--genre-name: genre-${genre.genre}`}
            >
              <header class="relative flex flex-col items-center justify-center gap-2 py-4 text-center">
                <span class="badge badge-secondary absolute right-4 top-4">
                  {formatCount(genre.count)}
                </span>
                <h3 class="genre-name text-lg font-semibold text-foreground group-hover:text-primary">
                  {genre.genre}
                </h3>
              </header>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};
