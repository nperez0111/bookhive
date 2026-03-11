---
description: Use Bun as the runtime. Vite for frontend bundling.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Vite handles client-side bundling (CSS via `@tailwindcss/vite`, JS/TSX transpilation). See `vite.config.ts`.

- Dev: `bun run dev` runs Bun server + Vite dev server in parallel. Vite proxies to Bun and injects HMR.
- Production: `bun run build` builds assets to `dist/public/` with a `manifest.json` for asset resolution.
- Asset URLs are resolved via `src/utils/manifest.ts` (reads Vite manifest in prod, points to Vite dev server in dev).
- Client entry: `src/entry.html` → `src/client/index.tsx`.
