import { join } from "path";

interface ExtractedConfig {
  key: string | null;
  identifier: string | null;
  signalVersion: string | null;
  decodedCount: number;
}

const WORKER_PATH = join(import.meta.dir, "extract-worker.ts");

export function extractConfig(script: string): Promise<ExtractedConfig> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Config extraction timed out"));
    }, 30_000);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data as ExtractedConfig);
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`Worker error: ${error.message}`));
    };

    worker.postMessage(script);
  });
}
