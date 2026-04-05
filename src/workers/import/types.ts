import type { StoredSession } from "@atcute/oauth-node-client";
import type { SessionClient } from "../../auth/client";
import type { Database } from "../../db";
import type { Storage } from "unstorage";
import type { AddWideEventContext } from "../../context";

/** Narrow context for import processing — no ingester, no getProfile, no HTTP request. */
export type ImportContext = {
  db: Database;
  kv: Storage;
  serviceAccountAgent: SessionClient | null;
  addWideEventContext: AddWideEventContext;
};

/** Main thread → worker: start an import job. */
export type ImportRequest = {
  type: "goodreads" | "storygraph";
  storedSession: StoredSession;
  csvData: ArrayBuffer;
  dbPath: string;
  kvPath: string;
};

/** Worker → main thread: relay an SSE event. */
export type ImportProgressMessage = {
  type: "sse";
  data: string;
};

/** Worker → main thread: import finished or fatally errored. */
export type ImportDoneMessage = {
  type: "done";
  error?: string;
};

export type ImportWorkerMessage = ImportProgressMessage | ImportDoneMessage;
