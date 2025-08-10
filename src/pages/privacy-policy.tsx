export function PrivacyPolicy() {
  return (
    <div class="bg-sand container mx-auto max-w-3xl px-4 py-12 dark:bg-zinc-900 dark:text-white">
      <h1 class="mb-6 text-4xl font-bold">Privacy Policy</h1>

      <p class="mb-4 text-slate-700 dark:text-slate-300">
        This Privacy Policy explains how <strong>BookHive</strong> ("we", "us",
        or "our") collects, uses, and shares information in connection with the
        BookHive service available at
        <a
          href="https://bookhive.buzz"
          class="ml-1 text-blue-600 hover:underline"
        >
          https://bookhive.buzz
        </a>
        . If you have any questions, contact us at
        <a
          href="mailto:computers@nickthesick.com"
          class="ml-1 text-blue-600 hover:underline"
        >
          computers@nickthesick.com
        </a>
        .
      </p>

      <h2 class="mt-10 mb-2 text-2xl font-semibold">About BookHive</h2>
      <p class="mb-4 text-slate-700 dark:text-slate-300">
        BookHive is a book management and social application built on top of the
        AT Protocol (ATProto), the same protocol used by Bluesky. ATProto is
        designed so that your social data lives on your own Personal Data Server
        (PDS).
      </p>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">Information We Collect</h2>
      <ul class="mb-4 list-inside list-disc text-slate-700 dark:text-slate-300">
        <li class="mb-2">
          <strong>Cookies for authentication</strong>: We set cookies only after
          you initiate a login session. These cookies are used strictly to keep
          you logged in and to operate the service. We do not set any cookies
          before you start a session, and we do not use cookies for advertising
          or cross-site tracking.
        </li>
        <li class="mb-2">
          <strong>Public ATProto data</strong>: BookHive displays and may cache
          data that is already publicly available on ATProto (for example,
          public profiles, posts, reviews, and book activity). We do not collect
          or store private ATProto data.
        </li>
      </ul>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">How We Use Information</h2>
      <p class="mb-4 text-slate-700 dark:text-slate-300">
        We use authentication cookies to operate BookHive, maintain your
        session, and provide functionality such as adding or viewing your book
        activity. Any ATProto data we process is limited to information that is
        already public.
      </p>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">
        Data Storage and Retention
      </h2>
      <p class="mb-4 text-slate-700 dark:text-slate-300">
        Your social graph and content live on your PDS via ATProto. We may
        temporarily cache public data and minimal session information on our
        servers to provide the service efficiently. We do not store non-public
        ATProto data.
      </p>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">
        Your Choices and Deletion
      </h2>
      <p class="mb-4 text-slate-700 dark:text-slate-300">
        Because your data lives on your PDS, you can remove your content at the
        source using your ATProto/Bluesky client. If you would like us to delete
        any information we hold on our servers (such as cached public data), you
        can request deletion at
        <a
          href="mailto:computers@nickthesick.com"
          class="ml-1 text-blue-600 hover:underline"
        >
          computers@nickthesick.com
        </a>
        .
      </p>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">Children’s Privacy</h2>
      <p class="mb-4 text-slate-700 dark:text-slate-300">
        BookHive is not directed to children under 13, and we do not knowingly
        collect personal information from children.
      </p>

      <h2 class="mt-8 mb-2 text-2xl font-semibold">Changes to This Policy</h2>
      <p class="mb-8 text-slate-700 dark:text-slate-300">
        We may update this Privacy Policy from time to time. When we do, we will
        revise the “Last updated” date below. Your continued use of BookHive
        after an update means you accept the changes.
      </p>

      <p class="text-sm text-slate-500 dark:text-slate-400">
        Last updated: {new Date().toISOString().slice(0, 10)}
      </p>
    </div>
  );
}
