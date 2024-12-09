# Book Hive 🐝

Goodreads, but better, built on Bluesky.

<img align="right" src="./public/bee.svg?raw=true" height="200" />

- OAuth with Bluesky with session storage, and persistence
- Defined Lexicons for books (with reviews, ratings, etc)
- Displaying a feed of new books & reviews from the firehose
- Works without JavaScript, but has some dynamic features
- All data is stored in your PDS, and can be used by other apps

I'll be posting updates on this [Bluesky thread](https://bsky.app/profile/nickthesick.com/post/3lb7ilmgrxk2u) to share my progress, but this is usable right now on <https://bookhive.buzz>.

## Vision

Goodreads has held the market for a long time, without improving their user experience, and with actively hampering their API access. I wanted to make a decentralized, Bluesky-based alternative to Goodreads.

The goal is to:

- Manage your read & want to read books
- Have a much nicer UI/UX than Goodreads
- "Buzz" about the books with friends with Bluesky comments
- Be decentralized, take your books to other apps if you want to!

Have a feature request? [Open an issue](https://github.com/nperez0111/bookhive/issues/new)!

## Development

To install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env` and fill in the values.

To run:

```bash
pnpm run dev
```

## Architecture

- **Backend**: [Hono](https://hono.dev) with AT Proto for OAuth
- **Frontend**: Mostly static HTML, with some Hono JSX for dynamic content (Fast as possible)
- **Database**: SQLite, with Kyesly as the ORM
