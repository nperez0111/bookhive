# 🐝 BookHive - A Better Goodreads

<p align="center">
    <a href="LICENSE" target="_blank">
        <img src="https://img.shields.io/github/license/nperez0111/bookhive.svg" alt="GitHub license">
    </a>
    <a href="https://github.com/nperez0111/bookhive/actions" target="_blank">
        <img src="https://img.shields.io/github/actions/workflow/status/nperez0111/bookhive/docker-build.yml" alt="Build workflow status">
    </a>
    <a href="https://github.com/nperez0111/bookhive/commits" target="_blank">
        <img src="https://img.shields.io/github/commit-activity/y/nperez0111/bookhive.svg" alt="GitHub commit activity">
    </a>
    <a href="https://github.com/nperez0111/bookhive/graphs/contributors" target="_blank">
        <img src="https://img.shields.io/github/contributors-anon/nperez0111/bookhive.svg" alt="GitHub contributors">
    </a>
</p>
<br/>

<img align="right" src="../public/reading.png?raw=true" height="240" />

Goodreads, but better, built on Bluesky.

- OAuth with Bluesky with session storage, and persistence
- Defined Lexicons for books (with reviews, ratings, etc)
- Displaying a feed of new books & reviews from the firehose
- Native iOS and Android applications built with Expo
- Public reading records live in your PDS; private ebooks and sync data live on BookHive

I'll be posting updates on this [Bluesky thread](https://bsky.app/profile/nickthesick.com/post/3lb7ilmgrxk2u) to share my progress, but this is usable right now on <https://bookhive.buzz>.

## 📱 iOS App Description

**BookHive - A Better Goodreads**

🐝 **Goodreads, but better, built on Bluesky**

BookHive is your decentralized alternative to Goodreads, offering a beautiful, modern reading experience that puts you in control of your book data.

**📚 What Makes BookHive Special:**

• **Beautiful, Modern UI** - Enjoy a clean, intuitive interface that's a breath of fresh air compared to outdated book platforms
• **Decentralized & Portable** - Your reading data lives on Bluesky, not locked away in a corporate silo
• **Social Reading Experience** - "Buzz" about books with friends through Bluesky comments and reviews
• **Smart Book Management** - Track your reading progress, manage your want-to-read list, and discover new books
• **Real-time Feed** - See what your friends are reading and reviewing in real-time
• **Privacy-First** - Your data belongs to you and can be used by other apps

**🎯 Perfect For:**
• Book lovers who want a better reading platform
• Bluesky users looking to connect over shared reading interests
• Anyone tired of Goodreads' cluttered interface and limited API access
• Readers who value data portability and decentralization

**✨ Key Features:**
• OAuth integration with Bluesky for seamless login
• Beautiful book covers and detailed information
• My Books search, filters, ownership, sorting and reading status (including abandoned)
• Editable reviews, half-star ratings, progress and reread history
• Ordered public shelves with tags and private ebook shelves
• Goodreads, StoryGraph and Hardcover imports
• Ebook upload, search, download and sharing; KOReader/OPDS setup
• Account re-sync and confirmed BookHive account deletion
• Social features with Bluesky integration
• Dark/light theme support
• Cached reading lists while offline; network access is required to confirm writes
• Cross-platform sync via Bluesky

**🔒 Your Data, Your Control:**
Unlike traditional book platforms, BookHive stores all your reading data on Bluesky's decentralized network. This means you can take your books, reviews, and reading history with you to other apps, and you're not locked into a single platform.

**🌟 Join the Hive:**
Start building your reading community today! BookHive is actively developed with regular updates and new features. Have a feature request? We'd love to hear from you!

Download BookHive now and experience the future of social reading. 🐝📖

## 📚 Vision

Goodreads has held the market for a long time, without improving their user experience, and with actively hampering their API access. I wanted to make a decentralized, Bluesky-based alternative to Goodreads.

The goal is to:

- Manage your read & want to read books
- Have a much nicer UI/UX than Goodreads
- "Buzz" about the books with friends with Bluesky comments
- Be decentralized, take your books to other apps if you want to!

Have a feature request? [Open an issue](https://github.com/nperez0111/bookhive/issues/new)!

## 📱 Mobile App Development

This workspace uses **Expo SDK 57.0.31 / React Native 0.86.3 / React 19.2.3**.
Native versions follow Expo's SDK 57 compatibility matrix, not the latest SDK 58.
Install with Bun from the repository root; `bun.lock` is shared with the server.

### Getting Started

1. Install dependencies from the repository root:

   ```bash
    bun install --frozen-lockfile
   ```

2. Start Metro from `app/`:

   ```bash
    bun run start
   ```

3. Choose your platform:
   - **iOS Simulator**: Press `i` in the terminal
   - **Android Emulator**: Press `a` in the terminal
   - **Physical Device**: Use a matching SDK 57 development build. A newer Expo Go may not support SDK 57.

### Running Tests

```bash
# Watch component/unit tests (Jest, not Bun's native test runner)
bun run test

# Deterministic CI checks
bun run test:run
bun run typecheck
bun run lint
bun run export:check
bunx expo install --check
```

Jest uses the Expo preset and React Native Testing Library. Its transform allowlist
supports Bun's isolated `.bun` dependency paths. React and the test renderer must
stay on the same exact version; the server workspace intentionally uses a different
React patch. Babel runtime is explicit because isolated installs do not expose
transitive Babel helpers to application imports.

CI runs mobile unit tests, TypeScript, ESLint, and iOS/Android JavaScript exports separately
from server tests. Exporting validates bundling, **not** native compilation, signing,
or device behavior. `dist/check/` contains export output
and is disposable (do not commit it).

### Native releases and updates

Version **1.3.0** introduces a new native runtime (`runtimeVersion: appVersion`),
including SDK 57, SecureStore, FileSystem, and Sharing. Build and install a new
binary before publishing updates for that runtime; an OTA update cannot upgrade
an installed SDK 56 binary or add native modules. Validate OAuth, secure session
restoration, ebook upload/download/sharing, and offline behavior on real devices.

EAS scripts use `bunx eas-cli@25.3.0`; `eas.json` requires that same version.
Use `bun run ios:build` or `bun run android:build` for native builds, and the
matching `ios:submit` / `android:submit` script after device validation. Signing
and store credentials must be configured separately; these checks do not publish.
`bun run ios:build` no longer changes versions implicitly. Run `bun run bump`
explicitly to update `app.json` and `package.json`; `[m]` selects minor and `[M]`
selects major. The script never stages or commits files. Review changes and refresh
the root lockfile with `bun install` after a version bump. EAS manages production
build numbers remotely; local build-number fields are version-derived defaults.

File handling uses the modern `File`/`Directory`/`Paths` API from
`expo-file-system`. Old `downloadAsync` callers must import
`expo-file-system/legacy`, not the package root. SecureStore's asynchronous API
stores native credentials; sharing uses `expo-sharing`'s `shareAsync`.

On Bun's isolated workspace install, Expo Doctor currently reports same-version
duplicates for Constants, FileSystem, Font, Linking, and Symbols in different
peer-context directories. Expo's autolinking/Metro resolution is enabled and both
mobile exports pass, but do not treat exports as proof that this warning is harmless
in a signed native build. Check autolinking and run a native build before release.
Do not delete the shared lockfile or change server React just to silence Doctor.

## 🏗️ Architecture

- **Backend**: [Hono](https://hono.dev) with AT Proto for OAuth
- **Frontend**: Mostly static HTML, with some Hono JSX for dynamic content (Fast as possible)
- **Mobile App**: React Native with Expo, using file-based routing
- **Database**: SQLite, with Kyesly as the ORM

## 📱 App Store Links

- **iOS**: [BookHive on the App Store](https://apps.apple.com/us/app/bookhive-a-better-goodreads/id6749799032)
- **Web**: [bookhive.buzz](https://bookhive.buzz)
