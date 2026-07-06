import { cleanEnv, num, port, str, testOnly } from "envalid";

// Bun loads .env automatically; envalid reads process.env

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    default: "production",
    devDefault: testOnly("test"),
    choices: ["development", "production", "test"],
  }),
  PORT: port({ default: 8080 }),
  PUBLIC_URL: str({
    default: "http://127.0.0.1:8080",
    devDefault: `http://127.0.0.1:${process.env["PORT"] ?? 8080}`,
    desc: "Public origin for OAuth callbacks (RFC 8252 requires loopback IP not localhost). In dev, auto-derives from PORT when not explicitly set.",
  }),
  DB_PATH: str({ devDefault: ":memory:", desc: "Path to the SQLite database" }),
  KV_DB_PATH: str({
    devDefault: ":memory:",
    desc: "Path to the KV SQLite database",
  }),
  WORKER_INDEX: str({
    default: "",
    desc: "Set by server/cluster.ts (0..N-1) when running multiple worker processes. Worker 0 — or unset (dev, tests, bare run) — is the primary: it runs migrations/VACUUM and the Jetstream ingester.",
  }),
  DB_CACHE_KB: num({
    default: 16384,
    desc: "SQLite page cache per connection, in KB. Kept small because each worker process (and its ingester/import worker threads) gets its own; the shared mmap serves most reads.",
  }),
  DB_MMAP_SIZE: num({
    default: 1073741824,
    desc: "SQLite mmap_size in bytes. mmap'd pages are file-backed and shared across all processes, so this does not multiply with WEB_CONCURRENCY.",
  }),
  EXPORT_SHARED_SECRET: str({
    default: "",
    desc: "Shared secret for triggering DB exports via /admin/export (Bearer token). Leave empty to disable.",
  }),
  DB_EXPORT_DIR: str({
    default: "",
    desc: "Directory to write temporary export artifacts. Defaults to the directory containing DB_PATH.",
  }),
  LOG_LEVEL: str({ default: "info", desc: "Log level for the app" }),
  COOKIE_SECRET: str({ devDefault: "00000000000000000000000000000000" }),
  OPEN_OBSERVE_URL: str({ devDefault: "" }),
  OPEN_OBSERVE_USER: str({ devDefault: "" }),
  OPEN_OBSERVE_PASSWORD: str({ devDefault: "" }),
  PDS_URL: str({
    default: "",
    desc: "Internal URL to reach the PDS (e.g. http://pds:3000). Empty disables signup.",
  }),
  PDS_ADMIN_PASSWORD: str({
    default: "",
    desc: "Admin password for the PDS, used to mint invite codes.",
  }),
  /** Optional: set in CI/deploy for observability (e.g. git rev-parse HEAD) */
  BUILD_SHA: str({ default: "", desc: "Commit or build identifier" }),
  BOOKHIVE_SERVICE_HANDLE: str({
    default: "",
    desc: "Handle for @bookhive.buzz service account (app password auth)",
  }),
  BOOKHIVE_APP_PASSWORD: str({
    default: "",
    desc: "App password for @bookhive.buzz service account",
  }),
  PRIVATE_KEY_JWK: str({
    default: "",
    desc: "ES256 private JWK for confidential OAuth client (generate with `bun run scripts/generate-jwk.ts`). When empty, falls back to public client.",
  }),
  IMGPROXY_URL: str({
    default: "",
    desc: "Internal base URL for the imgproxy service (e.g. http://imgproxy:8080). Empty disables proxying (the /images/* route falls back to redirecting to the source URL).",
  }),
  IMGPROXY_KEY: str({
    default: "",
    desc: "Hex-encoded imgproxy signing key (IMGPROXY_KEY). Empty uses unsafe URLs (dev only).",
  }),
  IMGPROXY_SALT: str({
    default: "",
    desc: "Hex-encoded imgproxy signing salt (IMGPROXY_SALT). Empty uses unsafe URLs (dev only).",
  }),
});
