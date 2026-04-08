import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { sql } from "kysely";
import { endTime, startTime } from "hono/timing";
import type { Kysely } from "kysely";
import type { Storage } from "unstorage";
import type { DatabaseSchema } from "../db";
import { readThroughCache } from "../utils/readThroughCache";

export interface AuthorWithStats {
  author: string;
  totalRatings: number;
  avgRating: number | null;
  bookCount: number;
  thumbnail: string | null;
}

type AuthorStats = Omit<AuthorWithStats, "thumbnail">;

function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}

const AUTHOR_EXPR = `CASE WHEN instr(authors, char(9)) > 0
       THEN trim(substr(authors, 1, instr(authors, char(9)) - 1))
       ELSE trim(authors)
  END`;

const FEATURED_COUNT = 8;

/**
 * Returns top authors with stats and their most popular book thumbnail.
 * Uses two queries to avoid a slow correlated subquery:
 *   1. Aggregation (GROUP BY first author, no thumbnail)
 *   2. Single scan of top books by ratingsCount to resolve thumbnails in JS
 */
export async function getTopAuthors(
  db: Kysely<DatabaseSchema>,
  limit: number,
): Promise<AuthorWithStats[]> {
  const statsResult = await sql<AuthorStats>`
    SELECT
      ${sql.raw(AUTHOR_EXPR)} as author,
      SUM(COALESCE(ratingsCount, 0)) as totalRatings,
      ROUND(AVG(CASE WHEN rating IS NOT NULL AND rating > 0 THEN rating END) / 1000.0, 1) as avgRating,
      COUNT(*) as bookCount
    FROM hive_book
    GROUP BY 1
    HAVING bookCount >= 2 AND totalRatings > 0
    ORDER BY totalRatings DESC
    LIMIT ${limit}
  `.execute(db);

  const authors = statsResult.rows;
  if (authors.length === 0) return [];

  // Resolve thumbnails with a single forward scan of the most-rated books.
  // All top-N authors' best books appear well within the first limit*150 rows.
  const thumbResult = await sql<{ author: string; thumbnail: string }>`
    SELECT ${sql.raw(AUTHOR_EXPR)} as author, thumbnail
    FROM hive_book
    WHERE thumbnail IS NOT NULL AND thumbnail != ''
    ORDER BY ratingsCount DESC
    LIMIT ${limit * 150}
  `.execute(db);

  const thumbnailByAuthor = new Map<string, string>();
  for (const row of thumbResult.rows) {
    if (!thumbnailByAuthor.has(row.author)) {
      thumbnailByAuthor.set(row.author, row.thumbnail);
    }
  }

  return authors.map((a) => ({
    ...a,
    thumbnail: thumbnailByAuthor.get(a.author) ?? null,
  }));
}

async function getAllAuthors(db: Kysely<DatabaseSchema>): Promise<AuthorStats[]> {
  const result = await sql<AuthorStats>`
    SELECT
      ${sql.raw(AUTHOR_EXPR)} as author,
      SUM(COALESCE(ratingsCount, 0)) as totalRatings,
      ROUND(AVG(CASE WHEN rating IS NOT NULL AND rating > 0 THEN rating END) / 1000.0, 1) as avgRating,
      COUNT(*) as bookCount
    FROM hive_book
    GROUP BY 1
    HAVING bookCount >= 2 AND totalRatings > 0
    ORDER BY totalRatings DESC
    LIMIT 500
  `.execute(db);
  return result.rows;
}

const AuthorCover: FC<{ thumbnail: string | null; author: string }> = ({ thumbnail, author }) => {
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt=""
        class="h-16 w-12 shrink-0 rounded object-cover shadow-sm"
        loading="lazy"
      />
    );
  }
  return (
    <div class="bg-muted flex h-16 w-12 shrink-0 items-center justify-center rounded">
      <span class="text-muted-foreground text-lg font-bold">{author[0]?.toUpperCase() ?? "?"}</span>
    </div>
  );
};

export const AuthorDirectory: FC = async () => {
  const c = useRequestContext();

  const { db, kv } = c.get("ctx");
  const cacheOpts = { ttl: 300_000 }; // 5 minutes

  startTime(c, "authors-featured");
  startTime(c, "authors-list");

  const [featured, all] = await Promise.all([
    readThroughCache<AuthorWithStats[]>(
      kv as Storage<AuthorWithStats[]>,
      "authors:featured",
      () => getTopAuthors(db, FEATURED_COUNT),
      [],
      cacheOpts,
    ).then((r) => {
      endTime(c, "authors-featured");
      return r;
    }),
    readThroughCache<AuthorStats[]>(
      kv as Storage<AuthorStats[]>,
      "authors:all",
      () => getAllAuthors(db),
      [],
      cacheOpts,
    ).then((r) => {
      endTime(c, "authors-list");
      return r;
    }),
  ]);

  return (
    <div class="bg-background -mx-4 -my-4 min-h-full px-4 py-6 lg:-mx-6 lg:-my-6 lg:px-6 lg:py-8">
      <div class="mx-auto max-w-5xl space-y-8">
        <nav class="text-muted-foreground flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <a
            href="/"
            class="hover:text-foreground min-h-[40px] inline-flex items-center transition-[color]"
          >
            Home
          </a>
          <span aria-hidden="true">›</span>
          <a
            href="/explore"
            class="hover:text-foreground min-h-[40px] inline-flex items-center transition-[color]"
          >
            Explore
          </a>
          <span aria-hidden="true">›</span>
          <span class="text-foreground font-medium">Authors</span>
        </nav>

        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
            Explore Authors
          </h1>
          <p class="text-muted-foreground mt-2 text-base">
            Discover books by your favourite authors.
          </p>
        </div>

        {/* Featured authors */}
        <section>
          <h2 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-widest">
            Most Popular
          </h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {featured.map((author) => (
              <a
                href={`/authors/${encodeURIComponent(author.author)}`}
                class="card group flex items-center gap-3 p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.96]"
              >
                <AuthorCover thumbnail={author.thumbnail} author={author.author} />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold leading-tight text-foreground group-hover:text-primary">
                    {author.author}
                  </p>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {formatCount(author.bookCount)} books
                  </p>
                  {author.avgRating && (
                    <p class="text-muted-foreground tabular-nums text-xs">
                      ★ {author.avgRating.toFixed(1)}
                    </p>
                  )}
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
              id="author-search"
              type="search"
              placeholder="Search all authors…"
              class="input w-full pl-9"
              aria-label="Search authors"
              autocomplete="off"
            />
          </div>

          <p id="author-empty" class="hidden py-8 text-center text-sm text-muted-foreground">
            No authors match your search.
          </p>

          <div id="author-list" class="card overflow-hidden">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {all.map((author) => (
                <a
                  href={`/authors/${encodeURIComponent(author.author)}`}
                  data-author={author.author.toLowerCase()}
                  class="group flex min-h-[40px] items-center gap-3 border-b border-border px-4 py-3 transition-[color,background-color] hover:bg-muted/60"
                >
                  <span class="flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {author.author}
                  </span>
                  <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatCount(author.bookCount)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var input=document.getElementById('author-search');
  var list=document.getElementById('author-list');
  var empty=document.getElementById('author-empty');
  input.addEventListener('input',function(){
    var q=this.value.toLowerCase().trim();
    var visible=0;
    list.querySelectorAll('[data-author]').forEach(function(el){
      var match=!q||el.getAttribute('data-author').includes(q);
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
