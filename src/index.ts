// Load OpenTelemetry SDK first (replaces node --require ./instrumentation.cjs)
import "./instrumentation";

import { instrument } from "./otel/index.ts";
import app from "./server";
import { env } from "./env";

import entryHtml from "./entry.html";

const server = Bun.serve({
  port: env.PORT,
  development: env.isDevelopment,
  routes: {
    "/_bundle": entryHtml,
  },
  fetch: instrument(app).fetch,
});

console.log(`Server is running on ${server.url}`);
