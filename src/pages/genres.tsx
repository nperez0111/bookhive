import { viewTransitionName } from "../lib/viewTransitionName";
import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { getEmoji } from "./genreEmoji";
import { formatCount } from "../lib/formatCount";
import { getTopGenres } from "../data/exploreGenres";
import {
  DirectoryRow,
  FilterableDirectory,
  FilterableDirectoryScript,
} from "./components/FilterableDirectory";

const FEATURED_COUNT = 8;

/** Genres with fewer than this many books are hidden from the directory. */
const MIN_GENRE_BOOKS = 10;
/** Generous ceiling: the page renders the whole list behind a client-side filter. */
const DIRECTORY_LIMIT = 2000;

export const GenresDirectory: FC<{ lang?: string }> = async ({ lang }) => {
  const c = useRequestContext();
  const { db, kv } = c.get("ctx");

  startTime(c, "genres-query");
  // `getTopGenres` owns the query, index hint, tiebreaker and SWR policy — don't reimplement it here.
  const genres = await getTopGenres(db, kv, DIRECTORY_LIMIT, lang, MIN_GENRE_BOOKS);
  endTime(c, "genres-query");

  const featured = genres.slice(0, FEATURED_COUNT);

  return (
    // Bleed edge-to-edge within main to cover the honeycomb background
    <div class="bg-background -mx-4 -my-4 min-h-full px-4 py-6 lg:-mx-6 lg:-my-6 lg:px-6 lg:py-8">
      <div class="mx-auto max-w-5xl space-y-8">
        <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <a href="/" class="hover:text-foreground transition-colors">
            Home
          </a>
          <span aria-hidden="true">›</span>
          <a href="/explore" class="hover:text-foreground transition-colors">
            Explore
          </a>
          <span aria-hidden="true">›</span>
          <span class="text-foreground font-medium">Genres</span>
        </nav>

        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
            Explore Genres
          </h1>
          <p class="text-muted-foreground mt-2 text-base">Discover books by genre.</p>
        </div>

        {/* Featured genres — count as the hero number */}
        <section>
          <h2 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-widest">
            Most Popular
          </h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {featured.map((genre) => (
              <a
                href={`/explore/genres/${encodeURIComponent(genre.genre)}`}
                // Matches the /explore genre tile's stacking (centred emoji → count → name) so the same object doesn't render two different ways a click apart.
                class="card group flex flex-col items-center gap-1 p-4 text-center transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.96]"
                style={`--genre-name: ${viewTransitionName("genre", genre.genre)}`}
              >
                <span class="text-2xl leading-none select-none" aria-hidden="true">
                  {getEmoji(genre.genre)}
                </span>
                <div class="text-2xl font-bold tabular-nums text-primary/70 group-hover:text-primary">
                  {formatCount(genre.count)}
                </div>
                <h3 class="genre-name text-sm font-semibold leading-tight text-foreground group-hover:text-primary">
                  {genre.genre}
                </h3>
              </a>
            ))}
          </div>
        </section>

        <FilterableDirectory
          placeholder="Search all genres…"
          label="Search genres"
          emptyMessage="No genres match your search."
        >
          {genres.map((genre) => (
            <DirectoryRow
              href={`/explore/genres/${encodeURIComponent(genre.genre)}`}
              filter={genre.genre}
              label={genre.genre}
              count={genre.count}
              leading={getEmoji(genre.genre)}
              labelClass="genre-name"
              style={
                featured.includes(genre)
                  ? undefined
                  : `--genre-name: ${viewTransitionName("genre", genre.genre)}`
              }
            />
          ))}
        </FilterableDirectory>

        <FilterableDirectoryScript />
      </div>
    </div>
  );
};
