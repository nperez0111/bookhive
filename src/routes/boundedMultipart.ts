import type { HonoRequest } from "hono";

export class MultipartTooLargeError extends Error {}
export class MultipartTimeoutError extends Error {}

// Count the actual wire bytes, including every field and multipart header.
// No pre-buffer/replay (bodyLimit does that for chunked requests), and never
// trust a small or missing Content-Length to bypass the streaming check.
export async function readBoundedMultipart(
  req: HonoRequest,
  maxBytes: number,
  timeoutMs = 5 * 60 * 1000,
): Promise<FormData> {
  const declaredLength = Number(req.header("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void req.raw.body?.cancel().catch(() => {});
    throw new MultipartTooLargeError();
  }

  const reader = req.raw.body?.getReader();
  if (!reader) return req.formData();
  let bytes = 0;
  let tooLarge = false;
  let timedOut = false;
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        bodyController = controller;
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (timedOut) return;
        if (done) {
          controller.close();
          return;
        }
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          tooLarge = true;
          controller.error(new MultipartTooLargeError());
          void reader.cancel().catch(() => {});
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );

  req.raw = new Request(req.raw, { body, duplex: "half" } as RequestInit);
  const deadline = setTimeout(() => {
    timedOut = true;
    const error = new MultipartTimeoutError();
    bodyController.error(error);
    void reader.cancel(error).catch(() => {});
  }, timeoutMs);
  try {
    // Populate Hono's normal body cache so a subsequent zValidator("form")
    // validates these same bytes without parsing/materialising them twice.
    return await req.formData();
  } catch (error) {
    // Some runtimes replace the stream error with a multipart parse error.
    if (timedOut) throw new MultipartTimeoutError();
    if (tooLarge) throw new MultipartTooLargeError();
    throw error;
  } finally {
    clearTimeout(deadline);
    void reader.cancel().catch(() => {});
  }
}
