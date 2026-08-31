import type { StoredSession } from "@atcute/oauth-node-client";
import type { BookUtilContext } from "../../context";

/** Narrow context for import processing — identical to BookUtilContext. */
export type ImportContext = BookUtilContext;

export const ImportType = {
  goodreads: "goodreads",
  storygraph: "storygraph",
  hardcover: "hardcover",
} as const;

export type ImportType = (typeof ImportType)[keyof typeof ImportType];

/** Main thread → worker: start an import job. */
export type ImportRequest = {
  type: ImportType;
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

/** Worker → main thread: relay a wide event for observability. */
export type ImportWideEventMessage = {
  type: "wide-event";
  context: Record<string, unknown>;
};

export type ImportWorkerMessage =
  | ImportProgressMessage
  | ImportDoneMessage
  | ImportWideEventMessage;
