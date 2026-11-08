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
    desc: "Suggested private SQLite page-cache target per main DB connection, in KiB; not a total memory limit. Web processes and ingester/import threads each open a connection. KV connections use separate settings.",
  }),
  DB_TEMP_STORE: str({
    default: "MEMORY",
    choices: ["MEMORY", "FILE"],
    desc: "Main DB connection temp_store; MEMORY keeps temporary B-trees in RAM, FILE permits disk spill but is not a memory cap. For FILE, set SQLITE_TMPDIR to an existing writable directory on real disk, not tmpfs, before startup. Does not configure KV connections.",
  }),
  DB_MMAP_SIZE: num({
    default: 0,
    desc: "SQLite mmap_size in bytes; 0 disables main DB mmap. Maps at most the first N bytes on demand, subject to SQLite's runtime/build limit; not a resident-memory cap. File-cache pages are shared across processes, and buffered reads also populate that cache. Benchmark the hot working set alongside anonymous memory and host/cgroup headroom before raising.",
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
  XRPC_SERVICE_AUTH_AUDIENCES: str({
    default: "",
    desc: "Comma-separated `aud` values this deployment answers for. Empty uses BOOKHIVE_DID plus its #bookhive_appview fragment. Matching is exact string equality — a bare DID does not match a fragment audience.",
  }),
  LIBRARY_DIR: str({
    default: "",
    desc: "Root directory for personal-library files. Empty derives it from dirname(DB_PATH)/library. Set explicitly to put the library on a different volume from the DB — and by the test preload, so tests can never write ebooks into the repo.",
  }),
  OPDS_DOWNLOAD_BASE_URL: str({
    default: "",
    desc: "Scheme+host to emit on OPDS acquisition (download) links instead of the request's own origin, e.g. https://dl.bookhive.buzz. The path is unchanged, and only the download link moves — feed/nav/cover links stay on the requested host. Point it at an origin that reaches this app directly (same auth, no CDN), so an e-reader's long-lived download isn't subject to whatever sits in front of the public host. Empty means unchanged behaviour.",
  }),
  PERSONAL_LIBRARY_QUOTA_BYTES: num({
    default: 2 * 1024 * 1024 * 1024,
    desc: "Total bytes of personal-library files one user may store. Enforced as SUM(personal_book.sizeBytes) evaluated *inside* the INSERT, so two concurrent uploads can't both observe the pre-insert total. The per-file ceiling (MAX_PERSONAL_BOOK_BYTES, 100 MB) applies on top. Excludes stored cover images, which are <1% of the total.",
  }),
  UPLOAD_PARSE_CONCURRENCY: num({
    default: 2,
    desc: "Per-process cap on concurrent ebook metadata parses. The parse is the only step that holds the whole file (<=100 MB) in native memory, so this is the memory bound on uploads — and it is per-process: with WEB_CONCURRENCY=4 the cluster-wide ceiling is this x 4 x 100 MB. See src/services/uploadPersonalBook.ts.",
  }),
});
