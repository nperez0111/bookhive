# Book Hive

Goodreads, but better.

- OAuth with Bluesky with session storage, and persistence
- Defined Lexicons for books & reviews
- Reading new books & reviews from the firehose

I'll be posting updates on this [Bluesky thread](https://bsky.app/profile/nickthesick.com/post/3lb7ilmgrxk2u).

## Vision

Goodreads has held the market for a long time, without improving their experience. I want to make a decentralized, Bluesky-based alternative to Goodreads.

The goal is to:

- Manage your read & want to read books
- "Buzz" about the books with friends with Bluesky comments
- Have a much nicer UI/UX
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
