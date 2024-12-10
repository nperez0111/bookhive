import pino from "pino";
import { env } from "../env";

export function getLogger(options: pino.LoggerOptions) {
  return pino({
    level: env.LOG_LEVEL,
    transport:
      env.isDev ||
      // Or if not enabled
      !env.OPEN_OBSERVE_URL ||
      !env.OPEN_OBSERVE_USER ||
      !env.OPEN_OBSERVE_PASSWORD
        ? undefined
        : {
            target: "./logger/open-observe.js",
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
          },
    ...options,
  });
}
