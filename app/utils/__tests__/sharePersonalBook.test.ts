import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { sharePersonalBook } from "../sharePersonalBook";
import type { PersonalBook } from "@/hooks/useBookhiveQuery";
import { authSession } from "@/context/auth";

jest.mock("@/context/auth", () => {
  const { createAuthSessionScope } = jest.requireActual("../../context/authSession");
  return { getBaseUrl: () => "https://bookhive.buzz", authSession: createAuthSessionScope() };
});
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
  moveAsync: jest.fn(),
  downloadAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
}));

const book = {
  contentHash: "abc123",
  filename: "My #1 ebook.epub",
  title: "Different catalogue title",
  format: "epub",
  mime: "application/epub+zip",
} as PersonalBook;

beforeEach(() => {
  jest.resetAllMocks();
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "private-session" });
  jest.mocked(FileSystem.createDownloadResumable).mockReturnValue({
    downloadAsync: FileSystem.downloadAsync,
    pauseAsync: jest.fn().mockResolvedValue({}),
  } as unknown as FileSystem.DownloadResumable);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(FileSystem.readDirectoryAsync).mockResolvedValue([]);
  jest.mocked(FileSystem.downloadAsync).mockResolvedValue({
    uri: "file:///cache/book.epub",
    status: 200,
    headers: {},
    mimeType: book.mime,
  });
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
});

it("authenticates the byte request in headers and shares a local file with its intrinsic name", async () => {
  await sharePersonalBook(book);
  const [url, target, options] = jest.mocked(FileSystem.createDownloadResumable).mock.calls[0];
  expect(url).toBe(
    "https://bookhive.buzz/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=abc123",
  );
  expect(url).not.toContain("private-session");
  expect(options?.headers).toEqual({ cookie: "sid=private-session" });
  expect(target).toMatch(/My%20%231%20ebook\.epub$/);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    "file:///cache/book.epub",
    expect.objectContaining({ mimeType: book.mime }),
  );
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it("never shares an error body and cleans failed downloads", async () => {
  jest.mocked(FileSystem.downloadAsync).mockResolvedValue({
    uri: "file:///cache/book.epub",
    status: 401,
    headers: {},
    mimeType: "application/json",
  });
  await expect(sharePersonalBook(book)).rejects.toThrow("session expired");
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringContaining("ebook-exports/"), {
    idempotent: true,
  });
});

it("prunes only older exports, retaining at most three after success", async () => {
  jest
    .mocked(FileSystem.readDirectoryAsync)
    .mockResolvedValue(["100-old", "200-middle", "300-new"]);
  await sharePersonalBook(book);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/ebook-exports/100-old", {
    idempotent: true,
  });
});

it("checks platform sharing support before downloading", async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(sharePersonalBook(book)).rejects.toThrow("isn't available");
  expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
});

it("shares a converted EPUB with the response MIME type and intrinsic filename stem", async () => {
  jest.mocked(FileSystem.downloadAsync).mockResolvedValue({
    uri: "file:///cache/original.mobi",
    status: 200,
    mimeType: "application/epub+zip",
    headers: { "Content-Disposition": "attachment; filename*=UTF-8''My%20ebook.epub" },
  });
  await sharePersonalBook({
    ...book,
    filename: "My ebook.mobi",
    format: "mobi",
    mime: "application/x-mobipocket-ebook",
  });
  expect(FileSystem.moveAsync).toHaveBeenCalledWith({
    from: "file:///cache/original.mobi",
    to: expect.stringMatching(/My%20ebook\.epub$/),
  });
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    expect.stringMatching(/My%20ebook\.epub$/),
    expect.objectContaining({ mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" }),
  );
});

it("rejects stale captured sessions before any download can use another account", async () => {
  const captured = authSession.capture();
  authSession.replace({ did: "did:plc:b", handle: "b.test", sid: "other-session" });
  await expect(sharePersonalBook(book, captured)).rejects.toThrow("session changed");
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

it("pauses an in-flight native download and refuses to share after logout", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pauseAsync = jest.fn().mockResolvedValue({});
  jest.mocked(FileSystem.createDownloadResumable).mockReturnValue({
    downloadAsync: () => {
      started();
      return new Promise(() => {});
    },
    pauseAsync,
  } as unknown as FileSystem.DownloadResumable);
  const pending = sharePersonalBook(book);
  await ready;
  authSession.replace(null);
  await expect(pending).rejects.toThrow("session changed");
  expect(pauseAsync).toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalled();
});
