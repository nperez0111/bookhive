import pino from "pino";
import { env } from "../env";
import buildOpenObserveTransport from "./open-observe";

const openObserveOptions =
  env.isDev || !env.OPEN_OBSERVE_URL || !env.OPEN_OBSERVE_USER || !env.OPEN_OBSERVE_PASSWORD
    ? undefined
    : {
        url: env.OPEN_OBSERVE_URL,
        organization: "bookhive",
        streamName: "server-logs",
        auth: {
          username: env.OPEN_OBSERVE_USER,
          password: env.OPEN_OBSERVE_PASSWORD,
        },
        writeToConsole: true,
      };

// Build the transport stream once at module load (runs in the main thread, no worker spawned).
// Using pino(opts, stream) avoids thread-stream entirely, which breaks when bundled by Nitro.
const transportStream = openObserveOptions
  ? buildOpenObserveTransport(openObserveOptions)
  : undefined;

export function getLogger(options: pino.LoggerOptions) {
  const base = { level: env.LOG_LEVEL, ...options };
  return transportStream ? pino(base, transportStream) : pino(base);
}
