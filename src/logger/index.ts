import path from "node:path";
import pino from "pino";
import { env } from "../env";

const openObserveTransport =
  env.isDev ||
  !env.OPEN_OBSERVE_URL ||
  !env.OPEN_OBSERVE_USER ||
  !env.OPEN_OBSERVE_PASSWORD
    ? undefined
    : {
        target: path.join(process.cwd(), "logger", "open-observe.js"),
        options: {
          url: env.OPEN_OBSERVE_URL,
          organization: "bookhive",
          streamName: "server-logs",
          auth: {
            username: env.OPEN_OBSERVE_USER,
            password: env.OPEN_OBSERVE_PASSWORD,
          },
          writeToConsole: true,
        },
      };

let openObserveSkippedLogged = false;

export function getLogger(options: pino.LoggerOptions) {
  const base = { level: env.LOG_LEVEL, ...options };
  if (!openObserveTransport) return pino(base);
  try {
    return pino({ ...base, transport: openObserveTransport });
  } catch (err) {
    // Fallback when transport file is missing (e.g. wrong cwd or dev without build)
    if (!openObserveSkippedLogged) {
      openObserveSkippedLogged = true;
      console.warn(
        "Pino OpenObserve transport skipped:",
        (err as Error).message,
      );
    }
    return pino(base);
  }
}
