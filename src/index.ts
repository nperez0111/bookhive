// Load OpenTelemetry SDK first (replaces node --require ./instrumentation.cjs)
import "./instrumentation";

import { instrument } from "./middleware/index.ts";
import app from "./server";
import { env } from "./env";
import { startEventLoopMonitor } from "./utils/event-loop-monitor";

import entryHtml from "./entry.html";

const instrumentedApp = instrument(app);

const server = Bun.serve({
  port: env.PORT,
  development: env.isDevelopment,
  routes: {
    "/_bundle": entryHtml,
  },
  fetch: instrumentedApp.fetch,
});

startEventLoopMonitor();

console.log(`Server is running on ${server.url}`);
