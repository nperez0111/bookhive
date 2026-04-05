import { createApp } from "./app";
import { createAppDeps } from "./context";
import { destroyLogger } from "./logger/index.ts";

const deps = await createAppDeps();
const startTime = new Date().toISOString();

const app = createApp({
  startTime,
  deps,
});

// Ensure worker threads are terminated on shutdown so the process can exit cleanly.
function shutdown() {
  void deps.ingester.destroy();
  destroyLogger();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
