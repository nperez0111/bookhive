import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireExportLock } from "../data/dbExportLock";
import { exportJobPaths, prepareSanitizedExportFiles, startTgzDownload } from "../data/dbExport";
import { createExportDownload } from "./dbExport";
import { getExportWorkerStats, prepareExportInWorker } from "../workers/export-client";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "bookhive-export-test-"));
  roots.push(root);
  const dbPath = path.join(root, "source.sqlite");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO books VALUES (1, 'Hive'); CREATE VIEW titles AS SELECT title FROM books",
  );
  db.close();
  const kvPath = path.join(root, "source-kv.sqlite");
  const kv = new Database(kvPath);
  kv.exec(
    "CREATE TABLE cache (key TEXT PRIMARY KEY, value BLOB); CREATE INDEX cache_values ON cache(value); CREATE TABLE auth_sessions (secret TEXT); CREATE TABLE auth_future (secret TEXT); INSERT INTO auth_sessions VALUES ('secret'); INSERT INTO auth_future VALUES ('secret')",
  );
  const insert = kv.prepare("INSERT INTO cache VALUES (?, ?)");
  kv.transaction(() => {
    for (let i = 0; i < 1024; i++) insert.run(String(i), crypto.randomBytes(1024));
  })();
  kv.close();
  return { root, dbPath, kvPath, exportDir: root, includeKv: true };
}

describe("bounded DB export", () => {
  test("real Worker preserves schema, digests, auth filtering and download tar", async () => {
    const options = await fixture();
    const untouched = path.join(options.root, "bookhive-export-another-job");
    await fsp.mkdir(untouched);
    const download = await createExportDownload(options);
    expect(download.status).toBe("ready");
    if (download.status !== "ready") throw new Error(JSON.stringify(download));
    expect((await createExportDownload(options)).status).toBe("busy");
    const archive = path.join(options.root, "download.tgz");
    await Bun.write(archive, new Response(download.stream));
    expect(await download.done).toBeUndefined();
    const unpack = path.join(options.root, "unpacked");
    await fsp.mkdir(unpack);
    const tar = Bun.spawn(["tar", "-xzf", archive, "-C", unpack], { stderr: "pipe" });
    expect(await tar.exited).toBe(0);
    const manifest = await Bun.file(path.join(unpack, "manifest.json")).json();
    expect(manifest.version).toBe("1.0");
    expect(manifest.schema).toEqual({ tables: ["books"], views: ["titles"] });
    expect(manifest.excludedKvTables).toEqual(["auth_sessions", "auth_state"]);
    for (const file of manifest.files) {
      const bytes = await Bun.file(path.join(unpack, file.name)).bytes();
      expect(bytes.length).toBe(file.size);
      expect(crypto.createHash("md5").update(bytes).digest("hex")).toBe(file.md5);
    }
    const kv = new Database(path.join(unpack, "kv.sqlite"), { readonly: true });
    try {
      expect(kv.query("SELECT count(*) AS n FROM cache").get()).toEqual({ n: 1024 });
      expect(kv.query("SELECT name FROM sqlite_master WHERE name LIKE 'auth_%'").all()).toEqual([]);
      expect(
        kv.query("SELECT name FROM sqlite_master WHERE name = 'cache_values'").get(),
      ).toBeTruthy();
    } finally {
      kv.close();
    }
    expect(await fsp.stat(untouched)).toBeTruthy();
    const release = acquireExportLock(options.root);
    expect(release).toBeFunction();
    release?.();
  }, 30_000);

  test("lock is immediate, idempotent and shared with a second process", async () => {
    const { root } = await fixture();
    const release = acquireExportLock(root)!;
    expect(acquireExportLock(root)).toBeUndefined();
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { acquireExportLock } from ${JSON.stringify(new URL("../data/dbExportLock.ts", import.meta.url).pathname)}; process.exit(acquireExportLock(${JSON.stringify(root)}) ? 9 : 0)`,
      ],
      { stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    release();
    release();
    const next = acquireExportLock(root);
    expect(next).toBeFunction();
    next?.();
    expect(await fsp.stat(path.join(root, ".bookhive-export-lock.sqlite"))).toBeTruthy();
  });

  test("completed tar does not release ownership before consumer finishes; cancellation cleans up", async () => {
    const options = await fixture();
    const download = await createExportDownload(options);
    if (download.status !== "ready") throw new Error(JSON.stringify(download));
    let finished = false;
    void download.done.then(() => {
      finished = true;
    });
    await Bun.sleep(30);
    expect(finished).toBe(false);
    expect(acquireExportLock(options.root)).toBeUndefined();
    await download.stream.cancel();
    expect(await download.done).toBeInstanceOf(Error);
    expect(
      (await fsp.readdir(options.root)).filter((name) => name.startsWith("bookhive-export-")),
    ).toEqual([]);
    const release = acquireExportLock(options.root);
    expect(release).toBeFunction();
    release?.();
  });

  test("disconnect during native preparation holds lock until acknowledgement", async () => {
    const options = await fixture();
    const source = new Database(options.dbPath);
    source.exec("BEGIN EXCLUSIVE");
    const abort = new AbortController();
    let settled = false;
    const pending = createExportDownload(options, abort.signal).then((result) => {
      settled = true;
      return result;
    });
    try {
      // Wait until the worker owns its known private directory, then give it
      // time to enter SQLite's native busy wait (web timers must still run).
      for (let i = 0; i < 200; i++) {
        if ((await fsp.readdir(options.root)).some((name) => name.startsWith("bookhive-export-")))
          break;
        await Bun.sleep(5);
      }
      await Bun.sleep(50);
      abort.abort();
      await Bun.sleep(50);
      expect(settled).toBe(false);
      expect(acquireExportLock(options.root)).toBeUndefined();
    } finally {
      source.exec("ROLLBACK");
      source.close();
    }
    expect((await pending).status).toBe("error");
    const release = acquireExportLock(options.root);
    expect(release).toBeFunction();
    release?.();
    expect(
      (await fsp.readdir(options.root)).filter((name) => name.startsWith("bookhive-export-")),
    ).toEqual([]);
  }, 10_000);

  test("worker preparation failure and pre-abort clean only the known job", async () => {
    const options = await fixture();
    const failure = await createExportDownload({
      ...options,
      dbPath: path.join(options.root, "missing.sqlite"),
    });
    expect(failure.status).toBe("error");
    expect((await createExportDownload(options, AbortSignal.abort())).status).toBe("error");
    expect(
      (await fsp.readdir(options.root)).filter((name) => name.startsWith("bookhive-export-")),
    ).toEqual([]);
    const release = acquireExportLock(options.root);
    expect(release).toBeFunction();
    release?.();
  });

  test("tar errors settle only after child closes, with bounded diagnostics", async () => {
    const { root } = await fixture();
    const download = startTgzDownload(
      root,
      Array.from({ length: 300 }, (_, i) => `missing-${i}`),
    );
    const responseError = await new Response(download.stream).arrayBuffer().catch((error) => error);
    expect(responseError).toBeInstanceOf(Error);
    const error = await download.done;
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.length).toBeLessThan(8300);
  });

  test("preparation supports bounded-step cancellation without changing other directories", async () => {
    const options = await fixture();
    const job = exportJobPaths(options.root);
    let checks = 0;
    const error = await prepareSanitizedExportFiles(options, job, () => {
      if (++checks > 12) throw new Error("test cancellation");
    }).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("test cancellation");
    expect(existsSync(job.tmpDir)).toBe(false);
  });

  test("worker deadline requests cancellation and waits for safe acknowledgement", async () => {
    const options = await fixture();
    const job = exportJobPaths(options.root);
    const error = await prepareExportInWorker(options, job, undefined, 0).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("timed out");
    expect(getExportWorkerStats()).toEqual({
      active: 0,
      cancellationRequested: 0,
      failedClosed: 0,
    });
    expect(existsSync(job.tmpDir)).toBe(false);
  });

  test("request abort after headers reaps tar/gzip and releases the cluster lock", async () => {
    const options = await fixture();
    const abort = new AbortController();
    const download = await createExportDownload(options, abort.signal);
    if (download.status !== "ready") throw new Error(JSON.stringify(download));
    abort.abort();
    expect(await download.done).toBeInstanceOf(Error);
    expect(
      await new Response(download.stream).arrayBuffer().catch((error) => error),
    ).toBeInstanceOf(Error);
    const release = acquireExportLock(options.root);
    expect(release).toBeFunction();
    release?.();
    expect(
      (await fsp.readdir(options.root)).filter((name) => name.startsWith("bookhive-export-")),
    ).toEqual([]);
  });

  test("OS releases lock after the holder process crashes", async () => {
    const { root } = await fixture();
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { acquireExportLock } from ${JSON.stringify(new URL("../data/dbExportLock.ts", import.meta.url).pathname)}; const release = acquireExportLock(${JSON.stringify(root)}); if (!release) process.exit(9); console.log('locked'); setInterval(() => { globalThis.release = release; }, 1000); globalThis.release = release`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    try {
      const reader = child.stdout.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toContain("locked");
      reader.releaseLock();
      expect(acquireExportLock(root)).toBeUndefined();
    } finally {
      child.kill("SIGKILL");
      await child.exited;
    }
    const release = acquireExportLock(root);
    expect(release).toBeFunction();
    release?.();
  });

  test("admin adapter preserves hidden auth rejection and explicit busy retry headers", async () => {
    const options = await fixture();
    const script = `
      import { Hono } from 'hono';
      import admin from ${JSON.stringify(new URL("../routes/admin.ts", import.meta.url).pathname)};
      import { acquireExportLock } from ${JSON.stringify(new URL("../data/dbExportLock.ts", import.meta.url).pathname)};
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('ctx', { addWideEventContext() {} });
        await next();
      });
      app.route('/admin', admin);
      const release = acquireExportLock(${JSON.stringify(options.root)});
      try {
        const hidden = await app.request('/admin/export');
        const busy = await app.request('/admin/export', { headers: { authorization: 'Bearer test-export-secret' } });
        console.log('RESULT=' + JSON.stringify({ hidden: hidden.status, busy: busy.status, retry: busy.headers.get('retry-after'), cache: busy.headers.get('cache-control') }));
      } finally { release(); }
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        EXPORT_SHARED_SECRET: "test-export-secret",
        DB_PATH: options.dbPath,
        DB_EXPORT_DIR: options.root,
        KV_DB_PATH: options.kvPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const result = stdout.split("\n").find((line) => line.startsWith("RESULT="));
    expect(JSON.parse(result!.slice(7))).toEqual({
      hidden: 404,
      busy: 503,
      retry: "60",
      cache: "no-store",
    });
  });
});
