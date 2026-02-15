import { createApp } from "./app";
import { createAppDeps } from "./context";

const deps = await createAppDeps();
const startTime = new Date().toISOString();

const app = createApp({
  startTime,
  deps,
});

export default app;
