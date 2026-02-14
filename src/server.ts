import { createApp } from "./app";
import { createAppDeps } from "./context";

const deps = await createAppDeps();
const startTime = new Date().toISOString();

const app = createApp({
  logger: deps.logger,
  startTime,
  deps,
});

export default app;
export const logger = deps.logger;
