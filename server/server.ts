import "../src/instrumentation";
import { instrument } from "../src/middleware/index.ts";
import app from "../src/server";
import { startEventLoopMonitor } from "../src/utils/event-loop-monitor";

startEventLoopMonitor();

export default instrument(app);
