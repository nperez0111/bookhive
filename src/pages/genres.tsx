import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { sql } from "kysely";
import { endTime, startTime } from "hono/timing";
import type { Storage } from "unstorage";
import { getEmoji } from "./genreEmoji";
import { readThroughCache } from "../utils/readThroughCache";

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

const FEATURED_COUNT = 8;

export const GenresDirectory: FC = async () => {
  const c = useRequestContext();
  const { db, kv } = c.get("ctx");

  startTime(c, "genres-query");
  const genres = await readThroughCache<GenreWithCount[]>(
    kv as Storage<GenreWithCount[]>,
    "genres:all",
    () =>
      db
        .selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")])
        .groupBy("genre")
        .having(sql`COUNT(*)`, ">", 10)
        .orderBy(sql`COUNT(*)`, "desc")
        .execute(),
    [],
    { ttl: 3_600_000 },
  );
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
                class="card group flex flex-col justify-between p-5 transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.06)] active:scale-[0.97]"
                style={`--genre-name: genre-${genre.genre}`}
              >
                <div class="text-3xl font-bold tabular-nums text-primary/70 group-hover:text-primary">
                  {formatCount(genre.count)}
                </div>
                <div class="mt-4">
                  <h3 class="genre-name font-semibold leading-tight text-foreground group-hover:text-primary">
                    {genre.genre}
                  </h3>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Search + full list */}
        <section>
          <div class="relative mb-4">
            <svg
              class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              id="genre-search"
              type="search"
              placeholder="Search all genres…"
              class="input w-full pl-9"
              aria-label="Search genres"
              autocomplete="off"
            />
          </div>

          <p id="genre-empty" class="hidden py-8 text-center text-sm text-muted-foreground">
            No genres match your search.
          </p>

          <div id="genre-list" class="card overflow-hidden">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {genres.map((genre) => (
                <a
                  href={`/explore/genres/${encodeURIComponent(genre.genre)}`}
                  data-genre={genre.genre.toLowerCase()}
                  class="group flex min-h-[44px] items-center gap-3 border-b border-border px-4 py-3 transition-[background-color,color] duration-150 hover:bg-muted/60 active:scale-[0.98]"
                  style={`--genre-name: genre-${genre.genre}`}
                >
                  <span
                    class="flex w-7 shrink-0 items-center justify-center text-lg leading-none"
                    aria-hidden="true"
                  >
                    {getEmoji(genre.genre)}
                  </span>
                  <span class="genre-name flex-1 text-sm font-medium text-foreground transition-colors duration-150 group-hover:text-primary">
                    {genre.genre}
                  </span>
                  <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatCount(genre.count)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var input=document.getElementById('genre-search');
  var list=document.getElementById('genre-list');
  var empty=document.getElementById('genre-empty');
  input.addEventListener('input',function(){
    var q=this.value.toLowerCase().trim();
    var visible=0;
    list.querySelectorAll('[data-genre]').forEach(function(el){
      var match=!q||el.getAttribute('data-genre').includes(q);
      el.style.display=match?'':'none';
      if(match)visible++;
    });
    empty.classList.toggle('hidden',visible>0);
  });
})();`,
          }}
        />
      </div>
    </div>
  );
};
