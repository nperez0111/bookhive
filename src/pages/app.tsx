import { type FC } from "hono/jsx";

function AppStoreBadge() {
  return (
    <a
      href="#"
      aria-label="Download on the App Store (coming soon)"
      class="inline-flex items-center gap-3"
      rel="noopener noreferrer"
    >
      <img
        src="/public/download_app_store.svg"
        alt="Download on the App Store"
        class="h-9 w-auto sm:h-10"
        loading="lazy"
        decoding="async"
      />
    </a>
  );
}

function Hero() {
  return (
    <section class="relative grid place-items-center px-4 pt-12 pb-8 md:pt-12 md:pb-20 lg:grid-cols-2 lg:px-8">
      <div class="relative z-10 order-2 mt-8 flex w-full justify-center lg:order-1 lg:mt-0">
        {/* Phone screenshot */}
        <div class="relative aspect-[9/19] w-[80%] max-w-[260px] overflow-hidden rounded-[2.5rem] border border-black/10 bg-black/90 shadow-2xl ring-1 ring-black/10 sm:max-w-[300px] md:max-w-[320px] lg:max-w-[360px] xl:max-w-[420px]">
          <img
            src="/public/screenshots/home-screen.png"
            alt="BookHive iOS — home screen"
            class="absolute inset-0 h-full w-full object-contain p-2"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <div class="relative z-10 order-1">
        <h1 class="text-4xl font-bold text-shadow-lg sm:text-5xl lg:text-6xl lg:tracking-tight xl:text-7xl xl:tracking-tighter">
          BookHive app for
          <span class="ml-2 text-yellow-800 dark:text-yellow-600">iPhone</span>
        </h1>
        <p class="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
          Manage, organize, and review your books anywhere. Follow friends,
          leave comments, and discover your next great read — all on iOS.
        </p>
        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          <AppStoreBadge />
          <a
            href="/"
            class="inline-flex items-center justify-center rounded-md border border-yellow-700 bg-yellow-50 px-3.5 py-2.5 text-sm font-medium text-yellow-900 shadow-xs hover:bg-yellow-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-100 dark:hover:bg-yellow-900"
          >
            Continue on the web
          </a>
        </div>
      </div>
      <div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-yellow-50 to-transparent dark:from-yellow-950" />
    </section>
  );
}

function Feature({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: any;
}) {
  return (
    <div class="flex items-start gap-4">
      <div class="mt-1 flex shrink-0 items-center justify-center rounded-full bg-yellow-800 p-2 text-white">
        {icon}
      </div>
      <div>
        <h3 class="text-lg font-semibold">{title}</h3>
        <p class="mt-2 leading-relaxed text-slate-500 dark:text-slate-300">
          {description}
        </p>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section class="px-4 lg:px-8">
      <div class="mt-16 text-center text-balance md:mt-0 lg:mx-0">
        <h2 class="text-4xl font-bold lg:text-5xl lg:tracking-tight">
          Everything you love about BookHive — now on iOS
        </h2>
        <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Keep your library with you. Add books, track progress, review, and
          connect with friends from anywhere.
        </p>
      </div>

      <div class="mt-12 grid gap-10 sm:grid-cols-2 md:grid-cols-3 md:gap-12 lg:mt-16 lg:gap-16">
        <Feature
          title="Manage your books"
          description="Add to your library, mark as reading, read, or want to read — right from your phone."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
            </svg>
          }
        />
        <Feature
          title="Follow your friends"
          description="See what your friends are buzzing about and discover books through your network."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
        <Feature
          title="Discover new books"
          description="Personalized search and recommendations help you find your next read."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10 10h4" />
              <path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3" />
              <path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z" />
              <path d="M 22 16 L 2 16" />
              <path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z" />
              <path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3" />
            </svg>
          }
        />
        <Feature
          title="Rate and review"
          description="Share ratings and thoughtful reviews — from quick notes to full commentary."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
            </svg>
          }
        />
        <Feature
          title="Comments & replies"
          description="Join conversations about books. Leave comments and reply to friends."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          }
        />
        <Feature
          title="Own your data"
          description="Built on the AT Protocol — your data, your account, your network."
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              <path d="M12 10v6" />
              <path d="m15 13-3 3-3-3" />
            </svg>
          }
        />
      </div>
    </section>
  );
}

function Screenshots() {
  return (
    <section class="mt-16 space-y-14 px-4 sm:mt-20 sm:space-y-16 lg:px-8">
      {/* Row 1 */}
      <div class="grid items-center gap-8 sm:gap-10 lg:grid-cols-2">
        <div class="order-1">
          <h3 class="text-2xl font-bold">Track your reading</h3>
          <p class="mt-3 text-slate-600 dark:text-slate-400">
            Quick actions and clean design make it effortless to add books,
            update status, and keep notes while you read.
          </p>
        </div>
        <div class="order-2 flex justify-center lg:order-2">
          <div class="relative aspect-[9/19] w-full max-w-[200px] overflow-hidden rounded-[2.5rem] border border-black/10 bg-black/90 shadow-2xl ring-1 ring-black/10 sm:max-w-[220px] md:max-w-[240px] lg:max-w-[260px] xl:max-w-[300px]">
            <img
              src="/public/screenshots/book-info.png"
              alt="BookHive iOS — book details screen"
              class="absolute inset-0 h-full w-full object-contain p-2"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </div>

      {/* Row 2 */}
      <div class="grid items-center gap-8 sm:gap-10 lg:grid-cols-2">
        <div class="order-2 flex justify-center lg:order-1">
          <div class="relative aspect-[9/19] w-full max-w-[200px] overflow-hidden rounded-[2.5rem] border border-black/10 bg-black/90 shadow-2xl ring-1 ring-black/10 sm:max-w-[220px] md:max-w-[240px] lg:max-w-[260px] xl:max-w-[300px]">
            <img
              src="/public/screenshots/comment.png"
              alt="BookHive iOS — comments and reviews"
              class="absolute inset-0 h-full w-full object-contain p-2"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
        <div class="order-1 lg:order-2">
          <h3 class="text-2xl font-bold">Share thoughts & reviews</h3>
          <p class="mt-3 text-slate-600 dark:text-slate-400">
            Leave comments, reply to friends, and post reviews that sync with
            your BookHive profile.
          </p>
        </div>
      </div>
    </section>
  );
}

export const AppPage: FC = () => {
  return (
    <div class="bg-sand container mx-auto max-w-7xl dark:bg-zinc-900 dark:text-white">
      <Hero />
      <Features />
      <Screenshots />
      <div class="my-16 text-center text-gray-500">
        See this project&nbsp;
        <a
          href="https://github.com/nperez0111/bookhive"
          class="text-blue-600 hover:underline"
        >
          on GitHub
        </a>
        , built by{" "}
        <a href="https://nickthesick.com" class="text-blue-600 hover:underline">
          Nick The Sick
        </a>
      </div>
    </div>
  );
};
