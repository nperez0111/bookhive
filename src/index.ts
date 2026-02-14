import { instrument } from "./middleware/index.ts";
import app from "./server";
import { env } from "./env";

import entryHtml from "./entry.html";

Bun.serve({
  port: env.PORT,
  development: env.isDevelopment,
  routes: {
    "/_bundle": entryHtml,
  },
  fetch: instrument(app).fetch,
});
