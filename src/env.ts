import dotenv from "dotenv";
import { cleanEnv, port, str, testOnly } from "envalid";

dotenv.config();

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
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
  LOG_LEVEL: str({ default: "info", desc: "Log level for the app" }),
  COOKIE_SECRET: str({ devDefault: "00000000000000000000000000000000" }),
  OPEN_OBSERVE_URL: str({ devDefault: "" }),
  OPEN_OBSERVE_USER: str({ devDefault: "" }),
  OPEN_OBSERVE_PASSWORD: str({ devDefault: "" }),
});
