import { type FC } from "hono/jsx";
import { raw } from "hono/html";
import { env } from "../env";
import { ThemeToggle, ThemeToggleScript } from "./components/ThemeToggle";

// Page-local, static CSS: no font downloads, animation runtime or new client island.
const appStyles = `
.app-site {
  --app-paper: var(--background);
  --app-ink: var(--foreground);
  --app-secondary: var(--muted-foreground);
  --app-accent: var(--primary);
  --app-tint: var(--muted);
  --app-line: var(--border);
  --app-shadow: 0 3px 8px #39241412, 0 24px 48px -18px #39241445;
  background: var(--app-paper);
  color: var(--app-ink);
  min-height: 100vh;
}
.dark .app-site {
  --app-shadow: 0 2px 6px #0003, 0 24px 48px -18px #0009;
}
.app-screenshot-dark { display: none; }
.dark .app-screenshot-light { display: none; }
.dark .app-screenshot-dark { display: block; }
.app-nav, .app-landing { width: min(100% - 64px, 1120px); margin-inline: auto; }
.app-nav { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 88px; border-bottom: 1px solid var(--app-line); }
.app-brand { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; font-size: 21px; font-weight: 700; letter-spacing: -.04em; border-radius: 8px; }
.app-nav-links { display: flex; align-items: center; gap: 28px; font-size: 13px; font-weight: 600; }
.app-nav-links a { display: inline-flex; align-items: center; min-height: 44px; border-radius: 4px; }
.app-nav a:hover { color: var(--app-accent); }
.app-nav .theme-toggle { color: var(--app-secondary); }
.app-nav .theme-toggle:hover { background: var(--app-tint); }
.app-landing { padding-block: 64px 36px; }
.app-landing > section + section { margin-top: 120px; }
.app-landing h1, .app-landing h2 { font-family: inherit; font-weight: 700; letter-spacing: -.025em; line-height: 1.1; text-wrap: balance; }
.app-landing h1 { font-size: clamp(48px, 5.2vw, 76px); }
.app-landing h2 { font-size: clamp(34px, 3.5vw, 48px); }
.app-landing p { text-wrap: pretty; }
.app-landing .text-muted-foreground { color: var(--app-secondary); }
.app-landing .text-primary { color: var(--app-accent); }
.app-landing .text-foreground { color: var(--app-ink); }
.app-hero { grid-template-columns: 1.1fr 1fr; gap: 64px; }
.app-hero-copy { padding-block: 32px; }
.app-hero h1 em { color: var(--app-accent); font-style: normal; font-weight: inherit; }
.app-hero-copy > p { max-width: 450px; }
.app-hero-copy .app-intro { font-size: 18px; line-height: 1.75; }
.app-landing .btn.btn-outline { background: transparent; color: var(--app-ink); border-color: var(--app-line); min-height: 40px; }
.app-landing .btn.btn-outline:hover { background: var(--app-tint); }
.app-landing .app-web-link { display: inline-flex; align-items: center; gap: 12px; min-height: 40px; font-size: 13px; font-weight: 600; border-radius: 4px; }
.app-web-link:hover { color: var(--app-accent); }
.app-web-link span { transition: transform 160ms ease-out; }
.app-web-link:hover span { transform: translateX(3px); }
.app-store-link { transition: transform 160ms ease-out; }
.app-store-link:hover { transform: translateY(-2px); }
.app-store-link:active { transform: scale(.96); }
.app-hero-stage { position: relative; isolation: isolate; padding: 30px 28px 20px; }
.app-hero-stage::before { content: ""; position: absolute; z-index: -1; inset: 12% 0 6%; border-radius: 48% 48% 8px 8px; background: var(--app-tint); }
.app-hero-stage::after { content: ""; position: absolute; z-index: -1; inset: 5% 8% 12%; border: 1px solid var(--app-line); border-radius: 48% 48% 8px 8px; transform: rotate(9deg); }
.app-device { overflow: hidden; border: 5px solid #302821; border-radius: 34px; outline: 1px solid #ffffff26; outline-offset: -1px; box-shadow: var(--app-shadow); background: #302821; }
.app-hero-stage .app-device { max-width: 252px; margin-inline: auto; transform: rotate(3deg); }
.app-hero-stage figcaption { margin-top: 28px; font-size: 11px; letter-spacing: .04em; }
.app-section-heading { max-width: 640px; }
.app-section-heading > p:last-child { max-width: 540px; }
.app-gallery { gap: 24px; }
.app-gallery figure { display: flex; flex-direction: column; padding: 28px 24px 24px; border-radius: 20px; background: var(--app-tint); }
.app-gallery figure:nth-child(2) { margin-top: 48px; margin-bottom: -48px; }
.app-gallery .app-device { width: min(100%, 230px); border-width: 4px; border-radius: 29px; }
.app-gallery figcaption { margin-top: 28px; width: 100%; }
.app-gallery h3 { display: flex; justify-content: space-between; align-items: baseline; font-size: 20px; }
.app-gallery h3 span { font-size: 11px; font-weight: 400; color: var(--app-secondary); font-variant-numeric: tabular-nums; }
.app-gallery figcaption p { font-size: 14px; line-height: 1.7; }
.app-landing > .app-tracking { margin-top: 168px; gap: 64px; }
.app-tracking ul { counter-reset: chapter; }
.app-tracking li { position: relative; padding: 16px 0 16px 42px; border-top: 1px solid var(--app-line); font-size: 14px; }
.app-tracking li::before { counter-increment: chapter; content: "0" counter(chapter); position: absolute; left: 0; top: 18px; color: var(--app-accent); font-size: 11px; font-variant-numeric: tabular-nums; }
.app-tracking li strong { display: block; margin-bottom: 2px; }
.app-tracking-stage { gap: 20px; padding: 32px 24px; background: var(--app-tint); border-radius: 24px; }
.app-tracking-stage .app-device { border-radius: 24px; border-width: 4px; }
.app-tracking-stage figcaption { font-size: 11px; }
.app-ipad { display: grid; grid-template-columns: 1fr; gap: 40px; padding: 48px; background: var(--app-tint); border-radius: 24px; }
.app-ipad > div { max-width: 640px; }
.app-ipad .app-device { border-radius: 20px; border-width: 6px; }
.app-ipad figure { width: min(100%, 800px); justify-self: center; }
.app-ipad figcaption { font-size: 11px; line-height: 1.6; }
.app-beyond { padding-top: 64px; border-top: 1px solid var(--app-line); }
.app-beyond article { border: 0; border-radius: 0; padding: 0 32px 0 0; }
.app-beyond article + article { padding: 0 0 0 32px; border-left: 1px solid var(--app-line); }
.app-beyond article p { font-size: 14px; }
.app-beyond article h3 { font-family: inherit; font-weight: 600; letter-spacing: -.025em; font-size: 28px; }
.app-questions { display: grid; grid-template-columns: .8fr 1.2fr; gap: 64px; padding-block: 48px; border-top: 1px solid var(--app-line); }
.app-questions h2 { font-size: 36px; }
.app-questions details { padding-block: 16px; border-bottom: 1px solid var(--app-line); }
.app-questions details:first-child { padding-top: 0; }
.app-questions summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; width: 100%; font-size: 14px; list-style: none; }
.app-questions summary::-webkit-details-marker { display: none; }
.app-questions summary::after { content: ""; flex: none; width: 14px; height: 14px; color: var(--app-accent); background: linear-gradient(currentColor, currentColor) center / 12px 1px no-repeat, linear-gradient(currentColor, currentColor) center / 1px 12px no-repeat; }
.app-questions details[open] summary::after { background-size: 12px 1px, 1px 0; }
.app-questions details p { font-size: 14px; }
.app-download { position: relative; padding: 64px 24px 0; border-top: 1px solid var(--app-line); }
.app-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 24px; margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--app-line); font-size: 12px; }
.app-footer a { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; border-radius: 4px; }
.app-landing section[id] { scroll-margin-top: 32px; }
@media (max-width: 900px) {
  .app-nav, .app-landing { width: min(100% - 48px, 1120px); }
  .app-hero { gap: 28px; }
  .app-hero h1 { font-size: clamp(44px, 6vw, 64px); }
  .app-hero-stage { padding-inline: 16px; }
  .app-gallery { gap: 16px; }
  .app-gallery figure { padding: 20px 16px; }
  .app-landing > .app-tracking { gap: 32px; }
  .app-ipad { gap: 32px; padding: 32px; }
  .app-questions { gap: 32px; }
}
@media (max-width: 639px) {
  .app-nav, .app-landing { width: calc(100% - 40px); }
  .app-nav { min-height: 72px; gap: 12px; }
  .app-nav-links { gap: 16px; }
  .app-nav-links .app-ipad-link { display: none; }
  .app-landing { padding-top: 24px; }
  .app-landing > section + section { margin-top: 80px; }
  .app-hero { grid-template-columns: 1fr; gap: 12px; }
  .app-hero-copy { padding-block: 24px 0; }
  .app-hero h1 { font-size: clamp(43px, 10.7vw, 64px); }
  .app-hero-copy .app-intro { font-size: 16px; }
  .app-hero-stage { width: min(100%, 360px); margin-inline: auto; padding: 28px 32px 16px; }
  .app-hero-stage .app-device { max-width: 218px; }
  .app-gallery { grid-template-columns: 1fr; gap: 24px; }
  .app-gallery figure { padding: 28px; }
  .app-gallery figure:nth-child(2) { margin: 0; }
  .app-gallery .app-device { max-width: 224px; }
  .app-gallery figcaption { max-width: 320px; }
  .app-landing > .app-tracking { margin-top: 80px; gap: 32px; }
  .app-tracking-stage { gap: 14px; padding: 24px 16px; }
  .app-tracking-stage .app-device { border-radius: 20px; border-width: 3px; }
  .app-ipad { grid-template-columns: 1fr; padding: 28px 20px; gap: 28px; }
  .app-ipad .app-device { border-radius: 14px; border-width: 4px; }
  .app-beyond { padding-top: 40px; }
  .app-beyond article, .app-beyond article + article { padding: 0; border: 0; }
  .app-beyond article + article { padding-top: 28px; border-top: 1px solid var(--app-line); }
  .app-questions { grid-template-columns: 1fr; gap: 32px; padding-block: 32px 0; }
  .app-download { padding: 48px 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .app-store-link, .app-web-link span { transition: none; }
}
`;

function AppStoreBadge() {
  return (
    <a
      href="https://apps.apple.com/us/app/bookhive-a-better-goodreads/id6749799032"
      aria-label="Download on the App Store"
      class="app-store-link focus-ring inline-flex min-h-10 items-center rounded-lg"
      rel="noopener noreferrer"
    >
      <img
        src="/download_app_store.svg"
        alt="Download on the App Store"
        width="120"
        height="40"
        class="h-10 w-auto"
        decoding="async"
      />
    </a>
  );
}

// Resized simulator captures, not recreated UI. Provenance lives beside the assets.
function Screenshot({
  name,
  alt,
  width,
  height,
  eager = false,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  eager?: boolean;
}) {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => {
        const file = theme === "dark" ? `${name}-dark` : name;
        return (
          <picture class={`app-screenshot-${theme}`}>
            <source type="image/webp" srcset={`/screenshots/app/${file}.webp`} />
            <img
              src={`/screenshots/app/${file}.png`}
              alt={alt}
              width={width}
              height={height}
              class="block h-auto w-full"
              loading={eager ? "eager" : "lazy"}
              fetchpriority={eager ? "high" : "auto"}
              decoding="async"
            />
          </picture>
        );
      })}
    </>
  );
}

const tabs = [
  {
    title: "My Books",
    name: "my-books",
    description:
      "That ever-growing book pile, sorted. Search your collection, filter by reading status, and switch between lists and covers.",
    alt: "My Books on iPhone with title and author search, reading statuses and half-star ratings",
  },
  {
    title: "Discover",
    name: "discover",
    description:
      "Find your next “just one more chapter.” Search by title, author or ISBN, browse genres, or see what the hive is reading.",
    alt: "Discover on iPhone with search, genre and author browsing, language selection and Community",
  },
  {
    title: "Profile",
    name: "profile",
    description:
      "Show off your shelves and leave a few reviews. Your reading history and stats live here too, under your own identity.",
    alt: "BookHive reader profile showing public shelves, reviews and reading statistics",
  },
];

export const AppPage: FC = () => (
  <div class="app-site">
    <style>{raw(appStyles)}</style>
    <header class="app-nav">
      <a href={env.PUBLIC_URL || "/"} class="app-brand focus-ring" aria-label="BookHive home">
        <img src="/book.svg" alt="" width="28" height="28" />
        BookHive
      </a>
      <nav class="app-nav-links" aria-label="App overview">
        <ThemeToggle class="focus-ring flex size-10 shrink-0 items-center justify-center rounded-full" />
      </nav>
    </header>
    <main class="app-landing">
      <section aria-labelledby="app-title" class="app-hero grid items-center">
        <div class="app-hero-copy">
          <h1 id="app-title">
            A little more buzz.
            <br />
            <em>A lot more books.</em>
          </h1>
          <p class="app-intro mt-6 text-muted-foreground">
            Keep your book pile close. Track what you read, share your verdict and find your next
            favourite on iPhone and iPad.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-6">
            <AppStoreBadge />
            <a href={env.PUBLIC_URL || "/"} class="app-web-link focus-ring">
              Continue on the web <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p class="mt-4 text-xs text-muted-foreground">
            Sign in with your Bluesky / AT Protocol account.
          </p>
          <a
            href="#inside-the-app"
            class="focus-ring mt-8 inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline"
          >
            Take a look inside ↓
          </a>
        </div>
        <figure class="app-hero-stage">
          <div class="app-device">
            <Screenshot
              name="home"
              alt="BookHive Home on iPhone with currently reading covers, reading totals, shelves and the four main tabs"
              width={600}
              height={1304}
              eager
            />
          </div>
        </figure>
      </section>

      <section id="inside-the-app" aria-labelledby="tabs-title" class="scroll-mt-8">
        <div class="app-section-heading">
          <h2 id="tabs-title" class="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Your books. Your next obsession.
          </h2>
        </div>
        <div class="app-gallery mt-10 grid sm:grid-cols-3">
          {tabs.map((tab, index) => (
            <figure key={tab.name} class="min-w-0">
              <div class="app-device mx-auto">
                <Screenshot name={tab.name} alt={tab.alt} width={560} height={1218} />
              </div>
              <figcaption class="mx-auto mt-6 max-w-sm">
                <h3 class="font-semibold">
                  {tab.title}
                  <span aria-hidden="true">0{index + 2}</span>
                </h3>
                <p class="mt-2 leading-relaxed text-muted-foreground">{tab.description}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="tracking-title"
        class="app-tracking grid items-center lg:grid-cols-2"
      >
        <div>
          <h2
            id="tracking-title"
            class="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
          >
            Every book gets a verdict.
          </h2>
          <p class="mt-5 leading-relaxed text-muted-foreground">
            Loved it? Left it halfway? Set a reading status, mark books you own, and give your
            verdict with half-star ratings and reviews.
          </p>
          <ul class="mt-6 leading-relaxed text-muted-foreground">
            <li>Update pages, chapters or a percentage.</li>
            <li>Record reading dates and revisit previous reads.</li>
            <li>See yearly reading stats and all-time totals.</li>
          </ul>
        </div>
        <div class="app-tracking-stage grid grid-cols-2 items-start">
          <figure>
            <div class="app-device mx-auto max-w-[220px]">
              <Screenshot
                name="book-details"
                alt="Dune book details with owned status, reading status, rating, review and reading dates"
                width={440}
                height={957}
              />
            </div>
          </figure>
          <figure class="mt-10">
            <div class="app-device mx-auto max-w-[220px]">
              <Screenshot
                name="progress"
                alt="Reading progress editor in light mode with pages, chapters, percentage and Save progress"
                width={440}
                height={957}
              />
            </div>
          </figure>
        </div>
      </section>

      <section id="on-ipad" aria-labelledby="ipad-title" class="app-ipad">
        <div>
          <h2 id="ipad-title" class="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            A bigger screen for your book pile.
          </h2>
          <p class="mt-4 leading-relaxed text-muted-foreground">
            Browse cover grids and view book details side by side on a larger screen.
          </p>
        </div>
        <figure class="mx-auto max-w-[620px]">
          <div class="app-device">
            <Screenshot
              name="ipad-home"
              alt="Actual iPad Home in light mode with a two-column reading dashboard, public shelves and recent activity"
              width={1240}
              height={1653}
            />
          </div>
        </figure>
      </section>

      <section aria-labelledby="beyond-title" class="app-beyond">
        <h2 id="beyond-title" class="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Share the book talk. Keep your files private.
        </h2>
        <div class="mt-8 grid gap-6 md:grid-cols-2">
          <article class="rounded-2xl border border-border p-6 sm:p-8">
            <h3 class="text-2xl font-semibold">See what the hive is reading.</h3>
            <p class="mt-4 leading-relaxed text-muted-foreground">
              Create and arrange public shelves, visit reader profiles, follow friends and discover
              books through the community feed. Share reviews and join book conversations with
              comments and replies.
            </p>
            <p class="mt-4 leading-relaxed text-muted-foreground">
              BookHive uses the same AT Protocol identity as Bluesky. Your public book records and
              catalogue shelves live in your account’s repository—not in a separate BookHive
              identity.
            </p>
          </article>
          <article class="rounded-2xl border border-border p-6 sm:p-8">
            <h3 class="text-2xl font-semibold">Bring your ebooks along.</h3>
            <p class="mt-4 leading-relaxed text-muted-foreground">
              Upload ebook files to private storage, organize them into private shelves, and
              download or share them to another app. Ebooks are separate from your public reading
              collection.
            </p>
            <p class="mt-4 leading-relaxed text-muted-foreground">
              Use OPDS to get books onto a compatible e-reader, and KOSync to sync reading progress
              from KOReader. Link sync documents to books to keep your tracking connected.
            </p>
            <p class="mt-4 text-sm text-muted-foreground">
              Read in your preferred reader. BookHive does not include an in-app ebook reader.
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="questions-title" class="app-questions">
        <div>
          <h2 id="questions-title">Before you dive in</h2>
        </div>
        <div>
          <details class="py-4">
            <summary class="focus-ring min-h-10 cursor-pointer py-2 font-semibold">
              Can I bring my existing reading history?
            </summary>
            <p class="pt-3 pb-2 leading-relaxed text-muted-foreground">
              Yes. Open Import on your Profile to import a CSV export from Goodreads, The StoryGraph
              or Hardcover.
            </p>
          </details>
          <details class="py-4">
            <summary class="focus-ring min-h-10 cursor-pointer py-2 font-semibold">
              Are my uploaded ebooks public?
            </summary>
            <p class="pt-3 pb-2 leading-relaxed text-muted-foreground">
              No. Ebook files and private ebook shelves are stored by BookHive for your account.
              They are not published to your AT Protocol repository. Your tracked books, reviews and
              public catalogue shelves are public.
            </p>
          </details>
          <details class="py-4">
            <summary class="focus-ring min-h-10 cursor-pointer py-2 font-semibold">
              Do I need to start over on the app?
            </summary>
            <p class="pt-3 pb-2 leading-relaxed text-muted-foreground">
              No. Use the same account on BookHive’s website and the app to access your reading
              collection, public shelves and private ebook library.
            </p>
          </details>
        </div>
      </section>

      <section aria-labelledby="download-title" class="app-download text-center">
        <h2 id="download-title" class="text-3xl font-bold tracking-tight sm:text-4xl">
          Take your book pile with you.
        </h2>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-4">
          <AppStoreBadge />
          <a href={env.PUBLIC_URL || "/"} class="btn btn-outline">
            Explore BookHive on the web
          </a>
        </div>
      </section>
      <footer class="app-footer text-muted-foreground">
        <p>
          Open source, built with care by{" "}
          <a href="https://nickthesick.com" class="focus-ring text-primary hover:underline">
            Nick The Sick
          </a>
          .
        </p>
        <a
          href="https://github.com/nperez0111/bookhive"
          class="focus-ring text-primary hover:underline"
        >
          See the project on GitHub
        </a>
      </footer>
    </main>
    <ThemeToggleScript />
  </div>
);
