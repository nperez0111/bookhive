
# 🐝 BookHive

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

<img align="right" src="./public/reading.png?raw=true" height="240" />

Goodreads, but better, built on Bluesky.

- OAuth with Bluesky with session storage, and persistence
- Defined Lexicons for books (with reviews, ratings, etc)
- Displaying a feed of new books & reviews from the firehose
- Works without JavaScript, but has some dynamic features
- All data is stored in your PDS, and can be used by other apps

I'll be posting updates on this [Bluesky thread](https://bsky.app/profile/nickthesick.com/post/3lb7ilmgrxk2u) to share my progress, but this is usable right now on <https://bookhive.buzz>.

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

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test

# Run tests once
pnpm test:run

# Run tests with UI
pnpm test:ui
```

## 🏗️ Architecture

- **Backend**: [Hono](https://hono.dev) with AT Proto for OAuth
- **Frontend**: Mostly static HTML, with some Hono JSX for dynamic content (Fast as possible)
- **Database**: SQLite, with Kyesly as the ORM

## 🗄️ Weekly database export (GitHub Actions artifact)

This repo includes a workflow that can fetch a **sanitized SQLite export** from your running BookHive instance and upload it as a GitHub Actions artifact (weekly cron + manual trigger).

- **Server endpoint**: `GET /admin/export`
  - Requires `EXPORT_SHARED_SECRET` to be set
  - Request header: `Authorization: Bearer <EXPORT_SHARED_SECRET>`
  - Returns a `.tgz` containing `db.sqlite`, `kv.sqlite` (with auth tables excluded), and `manifest.json`
- **Workflow**: `.github/workflows/database-export.yml`
  - Configure GitHub repo secrets:
    - `BOOKHIVE_EXPORT_URL` (e.g. `https://bookhive.example.com/admin/export`)
    - `BOOKHIVE_EXPORT_SHARED_SECRET`
