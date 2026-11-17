import { type FC } from "hono/jsx";
import { env } from "../env";

function AppStoreBadge() {
  return (
    <a
      href="https://apps.apple.com/us/app/bookhive-a-better-goodreads/id6749799032"
      aria-label="Download on the App Store"
      class="focus-ring inline-flex min-h-10 items-center rounded-lg"
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
    <picture>
      <source type="image/webp" srcset={`/screenshots/app/${name}.webp`} />
      <img
        src={`/screenshots/app/${name}.png`}
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
}

const tabs = [
  {
    title: "My Books",
    name: "my-books",
    description:
      "Your collection, your way. Search, filter by reading status, sort, and switch between list and cover-grid views.",
    alt: "My Books on iPhone with title and author search, reading statuses and half-star ratings",
  },
  {
    title: "Discover",
    name: "discover",
    description:
      "Find a title, author or ISBN. Browse genres and authors, choose a language, or head into the community feed.",
    alt: "Discover on iPhone with search, genre and author browsing, language selection and Community",
  },
  {
    title: "Profile",
    name: "profile",
    description:
      "A home for your reading life: public shelves, reviews, reading history and stats, all under your own identity.",
    alt: "BookHive reader profile in light mode showing a public shelf, reviews and reading statistics",
  },
];

export const AppPage: FC = () => (
  <div class="space-y-20 sm:space-y-28">
    <section
      aria-labelledby="app-title"
      class="grid items-center gap-12 pt-2 lg:grid-cols-2 lg:gap-16"
    >
      <div>
        <p class="text-sm font-semibold tracking-widest text-primary uppercase">
          BookHive for iPhone &amp; iPad
        </p>
        <h1
          id="app-title"
          class="mt-4 text-5xl leading-tight font-bold tracking-tight text-balance sm:text-6xl"
        >
          A little more buzz.
          <br />A lot more books.
        </h1>
        <p class="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Keep track of what you read, find what comes next, and share the good stuff. Your BookHive
          reading life, at home on your phone and tablet.
        </p>
        <div class="mt-8 flex flex-wrap items-center gap-4">
          <AppStoreBadge />
          <a href={env.PUBLIC_URL || "/"} class="btn btn-outline">
            Continue on the web
          </a>
        </div>
        <p class="mt-4 text-sm text-muted-foreground">
          Sign in with your Bluesky / AT Protocol account.
        </p>
        <a
          href="#inside-the-app"
          class="focus-ring mt-8 inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline"
        >
          Take a look inside ↓
        </a>
      </div>
      <figure class="rounded-3xl border border-border bg-muted/40 px-6 pt-8 pb-6 sm:px-10">
        <div class="mx-auto max-w-[300px] overflow-hidden rounded-[2rem] border border-border shadow-xl">
          <Screenshot
            name="home"
            alt="BookHive Home on iPhone with currently reading covers, reading totals, shelves and the four main tabs"
            width={600}
            height={1304}
            eager
          />
        </div>
        <figcaption class="mt-5 text-center text-sm text-muted-foreground">
          Home · Pick up where you left off.
        </figcaption>
      </figure>
    </section>

    <section id="inside-the-app" aria-labelledby="tabs-title" class="scroll-mt-8">
      <div class="max-w-2xl">
        <p class="text-sm font-semibold tracking-widest text-primary uppercase">
          Four tabs. One reading life.
        </p>
        <h2 id="tabs-title" class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Less hunting through menus.
          <br />
          More finding your next book.
        </h2>
        <p class="mt-4 leading-relaxed text-muted-foreground">
          Start with Home for your currently reading books, reading totals and recent activity. My
          Books, Discover and Profile keep everything else close by.
        </p>
      </div>
      <div class="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
        {tabs.map((tab) => (
          <figure key={tab.name} class="min-w-0">
            <div class="mx-auto max-w-[280px] overflow-hidden rounded-3xl border border-border shadow-lg">
              <Screenshot name={tab.name} alt={tab.alt} width={560} height={1218} />
            </div>
            <figcaption class="mx-auto mt-6 max-w-sm">
              <h3 class="text-xl font-semibold">{tab.title}</h3>
              <p class="mt-2 leading-relaxed text-muted-foreground">{tab.description}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>

    <section aria-labelledby="tracking-title" class="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <p class="text-sm font-semibold tracking-widest text-primary uppercase">
          Every chapter counts
        </p>
        <h2
          id="tracking-title"
          class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
        >
          Remember more than
          <br />
          the last page.
        </h2>
        <p class="mt-5 leading-relaxed text-muted-foreground">
          Want to read, reading, read or abandoned: keep your collection honest. Mark the books you
          own, give half-star ratings, and put your thoughts into a review.
        </p>
        <ul class="mt-6 space-y-4 leading-relaxed text-muted-foreground">
          <li>
            <strong class="text-foreground">Track your pace.</strong> Update pages, chapters or a
            percentage.
          </li>
          <li>
            <strong class="text-foreground">Keep the history.</strong> Record reading dates, revisit
            previous reads and see recent progress.
          </li>
          <li>
            <strong class="text-foreground">See the bigger picture.</strong> Explore your yearly
            reading stats and all-time totals.
          </li>
        </ul>
      </div>
      <div class="grid grid-cols-2 items-start gap-4 rounded-3xl border border-border bg-muted/40 p-4 sm:gap-6 sm:p-6">
        <figure>
          <div class="mx-auto max-w-[220px] overflow-hidden rounded-2xl border border-border shadow-lg">
            <Screenshot
              name="book-details"
              alt="Dune book details in dark mode with owned status, reading status, rating, review and reading dates"
              width={440}
              height={957}
            />
          </div>
          <figcaption class="mt-4 text-center text-sm text-muted-foreground">
            Make it your own
          </figcaption>
        </figure>
        <figure class="mt-10">
          <div class="mx-auto max-w-[220px] overflow-hidden rounded-2xl border border-border shadow-lg">
            <Screenshot
              name="progress"
              alt="Reading progress editor in light mode with pages, chapters, percentage and Save progress"
              width={440}
              height={957}
            />
          </div>
          <figcaption class="mt-4 text-center text-sm text-muted-foreground">
            Keep your place
          </figcaption>
        </figure>
      </div>
    </section>

    <section
      aria-labelledby="ipad-title"
      class="rounded-3xl border border-border bg-muted/40 p-6 sm:p-10"
    >
      <div class="mx-auto max-w-2xl text-center">
        <p class="text-sm font-semibold tracking-widest text-primary uppercase">
          Room to spread out
        </p>
        <h2 id="ipad-title" class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Your reading life, on a bigger canvas.
        </h2>
        <p class="mt-4 leading-relaxed text-muted-foreground">
          On iPad, Home gives your reading overview room to breathe. Browse your collection in an
          adaptive cover grid, with comfortable layouts for profiles, discovery and book details.
        </p>
      </div>
      <figure class="mx-auto mt-8 max-w-[620px]">
        <div class="overflow-hidden rounded-2xl border border-border shadow-xl">
          <Screenshot
            name="ipad-home"
            alt="Actual iPad Home in light mode with a two-column reading dashboard, public shelves and recent activity"
            width={1240}
            height={1653}
          />
        </div>
        <figcaption class="mt-4 text-center text-sm text-muted-foreground">
          A real iPad capture. Light and dark appearances on both devices.
        </figcaption>
      </figure>
    </section>

    <section aria-labelledby="beyond-title">
      <h2 id="beyond-title" class="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        Books bring people together.
        <br />
        Your files stay yours.
      </h2>
      <div class="mt-8 grid gap-6 md:grid-cols-2">
        <article class="rounded-2xl border border-border p-6 sm:p-8">
          <p class="text-sm font-semibold text-primary">The public side</p>
          <h3 class="mt-3 text-2xl font-semibold">Find your kind of readers.</h3>
          <p class="mt-4 leading-relaxed text-muted-foreground">
            Create and arrange public shelves, visit reader profiles, follow friends and discover
            books through the community feed. Share reviews and join book conversations with
            comments and replies.
          </p>
          <p class="mt-4 leading-relaxed text-muted-foreground">
            BookHive uses the same AT Protocol identity as Bluesky. Your public book records and
            catalogue shelves live in your account’s repository—not in a separate BookHive identity.
          </p>
        </article>
        <article class="rounded-2xl border border-border p-6 sm:p-8">
          <p class="text-sm font-semibold text-primary">The private side</p>
          <h3 class="mt-3 text-2xl font-semibold">Bring your ebooks along.</h3>
          <p class="mt-4 leading-relaxed text-muted-foreground">
            Upload ebook files to private storage, organize them into private shelves, and download
            or share them to another app. Ebooks are separate from your public reading collection.
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

    <section aria-labelledby="questions-title" class="mx-auto max-w-3xl">
      <h2 id="questions-title" class="text-2xl font-bold">
        A few things worth knowing
      </h2>
      <div class="mt-6 divide-y divide-border border-y border-border">
        <details class="py-4">
          <summary class="focus-ring min-h-10 cursor-pointer py-2 font-semibold">
            Can I bring my existing reading history?
          </summary>
          <p class="pt-3 pb-2 leading-relaxed text-muted-foreground">
            Yes. Open Library tools in My Books to import a CSV export from Goodreads, The
            StoryGraph or Hardcover. You can also open your public shelves, reading stats and Ebooks
            from there.
          </p>
        </details>
        <details class="py-4">
          <summary class="focus-ring min-h-10 cursor-pointer py-2 font-semibold">
            Are my uploaded ebooks public?
          </summary>
          <p class="pt-3 pb-2 leading-relaxed text-muted-foreground">
            No. Ebook files and private ebook shelves are stored by BookHive for your account. They
            are not published to your AT Protocol repository. Your tracked books, reviews and public
            catalogue shelves are public.
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

    <section aria-labelledby="download-title" class="text-center">
      <h2 id="download-title" class="text-3xl font-bold tracking-tight sm:text-4xl">
        Your next chapter starts here.
      </h2>
      <p class="mt-4 text-lg text-muted-foreground">Take BookHive with you on iPhone and iPad.</p>
      <div class="mt-6 flex flex-wrap items-center justify-center gap-4">
        <AppStoreBadge />
        <a href={env.PUBLIC_URL || "/"} class="btn btn-outline">
          Explore BookHive on the web
        </a>
      </div>
      <p class="mt-10 text-sm text-muted-foreground">
        Open source, built with care by{" "}
        <a href="https://nickthesick.com" class="focus-ring text-primary hover:underline">
          Nick The Sick
        </a>
        .{" "}
        <a
          href="https://github.com/nperez0111/bookhive"
          class="focus-ring text-primary hover:underline"
        >
          See the project on GitHub
        </a>
        .
      </p>
    </section>
  </div>
);
