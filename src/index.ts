import app from "./server";
import { env } from "./env";

import entryHtml from "./entry.html";

const server = Bun.serve({
  port: env.PORT,
  development: env.isDevelopment,
  routes: {
    "/_bundle": entryHtml,
  },
  fetch: app.fetch,
});

console.log(`Server is running on ${server.url}`);
