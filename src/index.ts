import app from "./server";
import { env } from "./env";

import entryHtml from "./entry.html";

const server = Bun.serve({
  port: env.PORT,
  development: env.isDevelopment,
  idleTimeout: 255, // seconds; max allowed by Bun. Needed for long-lived SSE streams (e.g. import worker).
  routes: {
    "/_bundle": entryHtml,
  },
  fetch: app.fetch,
});

console.log(`Server is running on ${server.url}`);
