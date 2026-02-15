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
    <div class="bg-sand container mx-auto max-w-7xl dark:bg-zinc-900 dark:text-white">
      <div class="flex flex-col gap-2 px-4 py-16 lg:px-8">
        <h1 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Explore Genres
        </h1>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Discover books by genre. Click on any genre to see all books in that
          category.
        </p>

        <div class="mt-8">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {genres.map((genre) => (
              <a
                href={`/genres/${encodeURIComponent(genre.genre)}`}
                class="group relative overflow-hidden rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-all duration-200 hover:border-yellow-400 hover:shadow-md dark:border-gray-700 dark:bg-zinc-800 dark:hover:border-yellow-500"
              >
                <div class="flex flex-col items-center text-center">
                  <h3
                    class="genre-name text-lg font-semibold text-gray-900 group-hover:text-yellow-600 dark:text-white dark:group-hover:text-yellow-400"
                    style={`--genre-name: genre-${genre.genre}`}
                  >
                    {genre.genre}
                  </h3>
                  <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {formatCount(genre.count)} books
                  </p>
                </div>

                {/* Hover effect overlay */}
                <div class="absolute inset-0 rounded-lg bg-gradient-to-t from-yellow-50/50 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:from-yellow-900/20" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
