import { expect, it } from "bun:test";
import type { SessionClient } from "../auth/client";
import type { ImportRequest, ImportSseAck, ImportWorkerMessage } from "../workers/import/types";

// Isolate the fake Worker from other route/worker tests in the shared Bun process.
if (process.env["BOOKHIVE_IMPORT_STREAM_CHECK"] === "1") {
  const { Hono } = await import("hono");
  const { testContext, createTestDb } = await import("../test/db");
  const { default: router, getImportAdmissionState } = await import("./import");
  const { db, close } = await createTestDb();
  class FakeWorker {
    static instances: FakeWorker[] = [];
    static lastSession: ImportRequest["storedSession"];
    onmessage?: (event: MessageEvent<ImportWorkerMessage>) => void;
    onerror?: (event: ErrorEvent) => void;
    acknowledged = 0;
    terminated = false;
    finishOnAck = true;
    constructor() {
      FakeWorker.instances.push(this);
    }
    emit(message: ImportWorkerMessage) {
      this.onmessage?.({ data: message } as MessageEvent<ImportWorkerMessage>);
    }
    postMessage(message: ImportRequest | ImportSseAck, transfer?: Transferable[]) {
      if (message.type === "sse-ack") {
        this.acknowledged++;
        queueMicrotask(() => {
          if (this.acknowledged === 1) this.emit({ type: "sse", data: '{"event":"book-load"}' });
          else if (this.acknowledged === 2)
            this.emit({
              type: "sse",
              data: '{"event":"import-complete","unmatchedBooks":[{"title":"Preserved"}]}',
            });
          else if (this.finishOnAck) this.emit({ type: "done" });
        });
      } else {
        FakeWorker.lastSession = message.storedSession;
        expect(transfer?.[0]).toBe(message.csvData);
        queueMicrotask(() => this.emit({ type: "sse", data: '{"event":"import-start"}' }));
      }
    }
    terminate() {
      this.terminated = true;
    }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const ctx = testContext({
    db,
    getSessionAgent: async () => ({ did: "did:plc:stream-test" }) as SessionClient,
  });
  await ctx.kv.set("auth_session:did:plc:stream-test", {});
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/import", router);
  const request = () => {
    const body = new FormData();
    body.append("export", new File(["some,csv"], "books.csv"));
    return app.request("/import/goodreads", { method: "POST", body });
  };
  try {
    const response = await request();
    const worker = FakeWorker.instances.at(-1)!;
    expect(getImportAdmissionState().active).toBe(1);
    // Hono's response stream can buffer one event, not the whole import.
    expect(worker.acknowledged).toBeLessThan(3);
    expect((await request()).status).toBe(503);
    expect(await response.text()).toContain('"unmatchedBooks":[{"title":"Preserved"}]');
    expect(worker.acknowledged).toBe(3);
    expect(worker.terminated).toBe(true);
    expect(getImportAdmissionState().active).toBe(0);

    const form = new FormData();
    form.append("export", new File(["some,csv"], "books.csv"));
    const encoded = new Request("http://localhost/", { method: "POST", body: form });
    const headers = new Headers(encoded.headers);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const refreshed = { refreshedDuringUpload: true };
    const upload = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          await ctx.kv.set("auth_session:did:plc:stream-test", refreshed);
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const refreshedResponse = await app.request(
      new Request("http://localhost/import/goodreads", {
        method: "POST",
        headers,
        body: upload,
      }),
    );
    const refreshedBody = await refreshedResponse.text();
    expect({ status: refreshedResponse.status, body: refreshedBody }).toMatchObject({
      status: 200,
    });
    expect(refreshedBody).toContain("import-complete");
    expect(FakeWorker.lastSession as unknown).toEqual(refreshed);

    const disconnected = await request();
    const disconnectedWorker = FakeWorker.instances.at(-1)!;
    disconnectedWorker.finishOnAck = false;
    await disconnected.body!.cancel();
    for (let i = 0; i < 100 && getImportAdmissionState().active; i++) await Bun.sleep(1);
    expect(disconnectedWorker.terminated).toBe(true);
    expect(getImportAdmissionState().active).toBe(0);
  } finally {
    await close();
  }
} else {
  it("holds admission through SSE, acknowledges only flushed events, and terminates on disconnect", async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      env: { ...process.env, BOOKHIVE_IMPORT_STREAM_CHECK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
  });
}
