import { serve } from "@hono/node-server";

import { env } from "./env";
import { instrument } from "./middleware/index.ts";

import app, { logger } from "./server";

// Re-export for backwards compatibility
export type { AppContext, HonoServer, Session } from "./context";
export { getSessionAgent } from "./context";

const server = serve(
  {
    fetch: instrument(app).fetch,
    port: env.PORT,
  },
  ({ port }) => {
    logger.info(
      `Server (${env.NODE_ENV}) running on port http://localhost:${port}`,
    );
  },
);

const onCloseSignal = () => {
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(() => {
    logger.info("server closed");
    process.exit();
  });
};

process.on("SIGINT", () => {
  logger.info("sigint received, shutting down");
  onCloseSignal();
});
process.on("SIGTERM", () => {
  logger.info("sigterm received, shutting down");
  onCloseSignal();
});
