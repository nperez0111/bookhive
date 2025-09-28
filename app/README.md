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
- Works without JavaScript, but has some dynamic features
- All data is stored in your PDS, and can be used by other apps

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
• Reading status tracking (currently reading, want to read, completed)
• Social features with Bluesky integration
• Dark/light theme support
• Offline reading list management
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

## 🧑‍💻 Development

To install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env` and fill in the values.

To run:

```bash
pnpm run dev
```

## 📱 Mobile App Development

This is the React Native/Expo mobile app for BookHive.

### Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npx expo start
   ```

3. Choose your platform:
   - **iOS Simulator**: Press `i` in the terminal
   - **Android Emulator**: Press `a` in the terminal
   - **Physical Device**: Scan the QR code with Expo Go app

### Running Tests

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test

# Run tests once
bun run test:run

# Run tests with UI
bun run test:ui
```

## 🏗️ Architecture

- **Backend**: [Hono](https://hono.dev) with AT Proto for OAuth
- **Frontend**: Mostly static HTML, with some Hono JSX for dynamic content (Fast as possible)
- **Mobile App**: React Native with Expo, using file-based routing
- **Database**: SQLite, with Kyesly as the ORM

## 📱 App Store Links

- **iOS**: [BookHive on the App Store](https://apps.apple.com/us/app/bookhive-a-better-goodreads/id6749799032)
- **Web**: [bookhive.buzz](https://bookhive.buzz)
