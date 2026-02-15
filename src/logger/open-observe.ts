import build from "pino-abstract-transport";
import { Transform, Writable } from "stream";

interface Options {
  url: string;
  organization: string;
  streamName: string;
  auth: {
    username: string;
    password: string;
  };
  batchSize?: number;
  timeThresholdMs?: number;
  /**
   * If false, logs will not be written to the console
   * @default true
   */
  writeToConsole?: boolean;
}

interface DefaultOptions {
  batchSize: number;
  timeThresholdMs: number;
}

const debugLog = (...args: any[]) => {
  if (process.env["LOG_OPENOBSERVE_DEBUG"]) {
    console.log(...args);
  }
};

// noinspection JSUnusedGlobalSymbols
/**
 * MUST export default async for pino to recognize the transport
 * This body was copied from:
 * https://github.com/openobserve/pino-openobserve/blob/main/index.js
 */
export default function (options: Options) {
  // Initialize the transport with asynchronous capabilities
  return build(async function (source) {
    debugLog("OpenObserve Pino: Transport initializing");

    // Default option values
    const defaultOptions: DefaultOptions = {
      batchSize: 100,
      // 5 second default, like datadog
      timeThresholdMs: 5 * 1000,
    };

    // Initialize log storage and utility variables
    const logs: any[] = [];
    let timer: NodeJS.Timeout | null = null;
    let apiCallInProgress = false;
    let failures = 0;
    let disableLogging = false;

    // Merge provided options with default options
    const opts: Options & DefaultOptions = {
      ...defaultOptions,
      ...options,
    };

    // Validate necessary options are provided
    if (!opts.url || !opts.organization || !opts.streamName) {
      debugLog("OpenObserve Pino: Missing required");
      throw new Error(
        "OpenObserve Pino: Missing required options: url, organization, or streamName",
      );
    }

    // Generate the API URL for logging
    const apiUrl = createApiUrl(opts);

    // Create a writable stream to handle the log data
    const destination = new Writable({
      objectMode: true,
      write(log, _, callback) {
        if (disableLogging) {
          callback();
          return;
        }
        debugLog("OpenObserve Pino: Log received:", log);

        if (opts.writeToConsole !== false) {
          console.log(JSON.stringify(log));
        }
        logs.push(log);
        scheduleSendLogs(callback);
      },
    });

    // Use event-driven programming to handle source to destination piping
    await pipelineAsync(source, destination);
    debugLog("OpenObserve Pino: Pipeline completed");

    // Create a promise-based function to handle pipeline completion
    function pipelineAsync(
      source: Transform & build.OnUnknown,
      destination: Writable,
    ): Promise<void> {
      debugLog("OpenObserve Pino: Piping source to destination");
      return new Promise((resolve, reject) => {
        source.pipe(destination).on("finish", resolve).on("error", reject);
      });
    }

    // Handle beforeExit to ensure all logs are sent
    process.on("beforeExit", () => {
      debugLog("OpenObserve Pino: Process beforeExit");
      if (logs.length > 0 && !apiCallInProgress) {
        sendLogs();
      }
    });

    // Function to construct API URL
    function createApiUrl({ url, organization, streamName }: Options): string {
      return `${url}/api/${organization}/${streamName}/_multi`;
    }

    // Schedule log sending based on batch size and time threshold
    function scheduleSendLogs(callback: () => void) {
      debugLog("OpenObserve Pino: Scheduling logs");
      if (timer) {
        clearTimeout(timer);
      }

      if (logs.length >= opts.batchSize && !apiCallInProgress) {
        sendLogs(callback);
      } else {
        timer = setTimeout(() => {
          (async () => {
            await sendLogs(callback);
          })();
        }, opts.timeThresholdMs);
      }
    }

    // Send logs to API
    async function sendLogs(callback?: () => void) {
      debugLog("OpenObserve Pino: Sending logs:", logs.length);
      if (logs.length === 0 || apiCallInProgress) {
        return;
      }

      apiCallInProgress = true;
      const { auth } = opts;
      const bulkLogs = logs
        .splice(0, opts.batchSize)
        .map((log) => JSON.stringify(log))
        .join(",");

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${auth.username}:${auth.password}`,
            ).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: `${bulkLogs}`,
        });

        if (!response.ok) {
          console.error(
            "Failed to send logs:",
            response.status,
            response.statusText,
          );
        } else if (process.env["LOG_OPENOBSERVE_DEBUG"]) {
          debugLog("Logs sent successfully:", await response.json());
        }
      } catch (error: any) {
        if (error.cause.code === "ECONNREFUSED") {
          failures++;
          if (failures > 2) {
            disableLogging = true;
            console.warn(
              "OpenObserve process not responding. Disabling logging.",
              error,
            );
          }
        } else {
          console.error("Failed to send logs:", error);
        }
      } finally {
        apiCallInProgress = false;
        // Call the callback to continue the stream
        callback?.();
      }
    }
  });
}
