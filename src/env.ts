import { cleanEnv, port, str, testOnly } from "envalid";

// Bun loads .env automatically; envalid reads process.env

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    default: "production",
    devDefault: testOnly("test"),
    choices: ["development", "production", "test"],
  }),
  PORT: port({ devDefault: testOnly(3000) }),
  PUBLIC_URL: str({}),
  DB_PATH: str({ devDefault: ":memory:", desc: "Path to the SQLite database" }),
  KV_DB_PATH: str({
    devDefault: ":memory:",
    desc: "Path to the KV SQLite database",
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
  /** Optional: set in CI/deploy for observability (e.g. git rev-parse HEAD) */
  BUILD_SHA: str({ default: "", desc: "Commit or build identifier" }),
});
