// Load OpenTelemetry SDK first (replaces node --require ./instrumentation.cjs)
import { env } from "./src/env.ts";
import "./src/instrumentation";

import { instrument } from "./src/otel/index.ts";
import app from "./src/server.ts";

console.log("here");

export default {
  fetch: instrument(app).fetch,
  port: env.PORT,
  development: env.isDevelopment,
};
