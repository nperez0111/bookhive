import { type FC } from "hono/jsx";
import { useRequestContext } from "hono/jsx-renderer";
import { endTime, startTime } from "hono/timing";
import { getAuthorStats, getFeaturedAuthors } from "../utils/authorStats";
import { sourceCoverImageUrl } from "../utils/imageProxy";
import { LanguageSelect } from "./components/LanguageSelect";
import { buildUrl } from "./utils/buildUrl";

function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}

const FEATURED_COUNT = 8;

const AuthorCover: FC<{ thumbnail: string | null; author: string }> = ({ thumbnail, author }) => {
  if (thumbnail) {
    return (
      <img
        src={sourceCoverImageUrl(thumbnail)}
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

interface AuthorDirectoryProps {
  lang?: string;
  languages: string[];
}

export const AuthorDirectory: FC<AuthorDirectoryProps> = async ({ lang, languages }) => {
  const c = useRequestContext();

  const { db, kv } = c.get("ctx");

  startTime(c, "authors-featured");
  startTime(c, "authors-list");

  // `featured` is the top FEATURED_COUNT of `all` plus covers, so on a cold
  // cache this is one aggregate, not two. Both are cached with SWR inside the
  // helpers (see src/utils/authorStats.ts).
  const [featured, all] = await Promise.all([
    getFeaturedAuthors(db, kv, FEATURED_COUNT, lang).then((r) => {
      endTime(c, "authors-featured");
      return r;
    }),
    getAuthorStats(db, kv, lang).then((r) => {
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
            class="hover:text-foreground min-h-10 inline-flex items-center transition-[color]"
          >
            Home
          </a>
          <span aria-hidden="true">›</span>
          <a
            href={buildUrl("/explore", { lang })}
            class="hover:text-foreground min-h-10 inline-flex items-center transition-[color]"
          >
            Explore
          </a>
          <span aria-hidden="true">›</span>
          <span class="text-foreground font-medium">Authors</span>
        </nav>

        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
              Explore Authors
            </h1>
            <p class="text-muted-foreground mt-2 text-base">
              Discover books by your favourite authors.
            </p>
          </div>
          <LanguageSelect
            languages={languages}
            currentLang={lang}
            baseUrl="/explore/authors"
            paramName="lang"
          />
        </div>

        {/* Featured authors */}
        <section>
          <h2 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-widest">
            Most Popular
          </h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {featured.map((author) => (
              <a
                href={buildUrl(`/authors/${encodeURIComponent(author.author)}`, { lang })}
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
                  href={buildUrl(`/authors/${encodeURIComponent(author.author)}`, { lang })}
                  data-author={author.author.toLowerCase()}
                  class="group flex min-h-10 items-center gap-3 border-b border-border px-4 py-3 transition-[color,background-color] hover:bg-muted/60"
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
