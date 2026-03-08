import { createApp } from "./app";
import { createAppDeps } from "./context";
import { env } from "./env";
import { resolveProductionPublicRoot } from "./utils/manifest";

const deps = await createAppDeps();
const startTime = new Date().toISOString();
const productionPublicRoot = env.isProduction ? await resolveProductionPublicRoot() : undefined;

const app = createApp({
  startTime,
  deps,
  productionPublicRoot: productionPublicRoot ?? undefined,
});

export default app;
