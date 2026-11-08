import {
  prepareSanitizedExportFiles,
  type ExportOptions,
  type PrepareResult,
} from "../data/dbExport";
import type { SingleShotReply } from "./singleShot";

export type ExportRequest = {
  id: string;
  options: ExportOptions;
  job: PrepareResult;
  cancellation: SharedArrayBuffer;
};

declare var self: Worker;

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const { id, options, job, cancellation } = event.data;
  const checkCancelled = () => {
    if (Atomics.load(new Int32Array(cancellation), 0))
      throw new Error("Export preparation cancelled");
  };
  let reply: SingleShotReply<PrepareResult>;
  try {
    const result = await prepareSanitizedExportFiles(options, job, checkCancelled);
    checkCancelled();
    reply = { id, ok: true, ...result };
  } catch (error) {
    reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // Every native handle is closed before this acknowledgement. Only now is it
  // safe for the parent to terminate the VM, delete files and release the lock.
  self.postMessage(reply);
};
