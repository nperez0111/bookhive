// Load OpenTelemetry SDK first (replaces node --require ./instrumentation.cjs)
import "./instrumentation";

import { instrument } from "./otel/index.ts";
import app from "./server";

export default instrument(app).fetch;

// console.log(`Server is running on ${server.url}`);
