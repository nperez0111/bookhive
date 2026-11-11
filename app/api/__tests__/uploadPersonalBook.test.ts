import { authSession } from "@/context/auth";
import { uploadBookFile, UploadError } from "../uploadPersonalBook";

jest.mock("@/context/auth", () => ({
  authSession: jest.requireActual("@/context/authSession").createAuthSessionScope(),
  getBaseUrl: () => "https://bookhive.buzz",
}));

const originalXHR = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
let xhr: {
  open: jest.Mock;
  setRequestHeader: jest.Mock;
  send: jest.Mock;
  upload: Record<string, unknown>;
  status: number;
  responseText: string;
  onload?: () => void;
  onloadend?: () => void;
};
beforeEach(() => {
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "a" });
  xhr = {
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(),
    upload: {},
    status: 200,
    responseText: "",
  };
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: jest.fn(() => xhr),
  });
});
afterEach(() => {
  if (originalXHR) Object.defineProperty(globalThis, "XMLHttpRequest", originalXHR);
  else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
});

test.each([{ book: {} }, { book: "invalid" }, { book: { contentHash: 123 } }, null])(
  "rejects a malformed successful upload without reporting completion: %p",
  async (payload) => {
    const onProgress = jest.fn();
    const pending = uploadBookFile(
      { uri: "file:///a.epub", name: "a.epub", onProgress },
      authSession.capture(),
    );
    xhr.responseText = JSON.stringify(payload);
    xhr.onload!();
    xhr.onloadend!();
    await expect(pending).rejects.toThrow("invalid upload response");
    expect(onProgress).not.toHaveBeenCalledWith(1);
  },
);

test("preserves quota prose and typed metadata but rejects object-valued errors", async () => {
  for (const error of ["Your storage is full", { internal: "not user prose" }]) {
    const pending = uploadBookFile(
      { uri: "file:///a.epub", name: "a.epub" },
      authSession.capture(),
    );
    xhr.status = 413;
    xhr.responseText = JSON.stringify({
      error,
      code: "QuotaExceeded",
      usedBytes: 42,
      quotaBytes: 40,
    });
    xhr.onload!();
    xhr.onloadend!();
    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: "UploadError",
        code: "QuotaExceeded",
        usedBytes: 42,
        quotaBytes: 40,
        message: typeof error === "string" ? error : "Upload failed (413)",
      } satisfies Partial<UploadError>),
    );
  }
});

test("accepts a complete private-file response", async () => {
  const book = {
    contentHash: "hash",
    title: "Book",
    format: "epub",
    mime: "application/epub+zip",
    sizeBytes: 42,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  const pending = uploadBookFile({ uri: "file:///a.epub", name: "a.epub" }, authSession.capture());
  xhr.responseText = JSON.stringify({ book });
  xhr.onload!();
  xhr.onloadend!();
  await expect(pending).resolves.toEqual({ book });
});
