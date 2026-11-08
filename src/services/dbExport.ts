import fsp from "node:fs/promises";
import {
  cleanupExportPaths,
  exportJobPaths,
  startTgzDownload,
  type ExportOptions,
} from "../data/dbExport";
import { acquireExportLock } from "../data/dbExportLock";
import { prepareExportInWorker } from "../workers/export-client";

export type ExportDownloadResult =
  | { status: "busy" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      filename: string;
      stream: ReadableStream<Uint8Array>;
      done: Promise<Error | undefined>;
    };

export async function createExportDownload(
  options: ExportOptions,
  signal?: AbortSignal,
): Promise<ExportDownloadResult> {
  let release: (() => void) | undefined;
  const job = exportJobPaths(options.exportDir);
  try {
    await fsp.mkdir(options.exportDir, { recursive: true });
    release = acquireExportLock(options.exportDir);
    if (!release) return { status: "busy" };
    const prepared = await prepareExportInWorker(options, job, signal);
    const download = startTgzDownload(prepared.tmpDir, prepared.files, signal);
    const unlock = release;
    const done = download.done.then(async (error) => {
      try {
        await cleanupExportPaths({ tmpDir: job.tmpDir });
      } finally {
        unlock();
      }
      return error;
    });
    return { status: "ready", filename: prepared.filename, stream: download.stream, done };
  } catch (error) {
    try {
      await cleanupExportPaths({ tmpDir: job.tmpDir });
    } finally {
      release?.();
    }
    return { status: "error", error };
  }
}
