# Routes structure (Hono best practices)

Routes are split by domain and mounted with `app.route()`.

## Layout

- **`index.ts`** – Barrel: `mainRouter`, `createRouter`, `searchBooks`. Use `import { mainRouter, searchBooks } from "./routes"` or `"./routes/index"`.
- **`main.tsx`** – Composes context, auth, jsx layout, images, methodOverride, then mounts domain routers and xrpc.
- **`lib.ts`** – Shared helpers: `searchBooks`, `refetchBooks`, `refetchBuzzes`, `ensureBookIdentifiersCurrent`, `syncFollowsIfNeeded`.
- **`admin.ts`** – `/admin/export`. Mounted at `/admin` from `app.ts`.
- **`import.ts`** – `/import/goodreads`, `/import/storygraph`. Mounted at `/import` from `app.ts`.
- **`pages.tsx`** – `/`, `/.well-known/atproto-did`, `/app`, `/privacy-policy`, `/import`, `/genres`, `/genres/:genre`, `/authors/:author`. Mounted at `/` in main.
- **`profile.tsx`** – `/profile`, `/profile/:handle`, `/profile/:handle/image`, `/refresh-books`. Mounted at `/` in main.
- **`books.tsx`** – `/:hiveId`, `/:hiveId/comments`, POST `/`, DELETE `/:hiveId`. Mounted at `/books` in main.
- **`comments.tsx`** – POST `/`, DELETE `/:commentId`. Mounted at `/comments` in main.
- **`api.tsx`** – `/update-book`, `/update-comment`, `/follow`, `/follow-form`. Mounted at `/api` in main.

## Main app (`app.ts`)

Global middleware, health/metrics, then `app.route("/admin", adminRoutes)`, `app.route("/import", importRoutes)`, `app.route("/", mainRouter(deps))`, static, sitemap, 404.
