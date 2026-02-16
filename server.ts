// Load OpenTelemetry SDK first (replaces node --require ./instrumentation.cjs)
import "./src/instrumentation";

import { instrument } from "./src/otel/index.ts";
import app from "./src/server.ts";

console.log("here");

export default instrument(app).fetch;
