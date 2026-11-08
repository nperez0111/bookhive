import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Database as DatabaseSync } from "bun:sqlite";
import { Readable } from "node:stream";

type ExportResult = { archivePath: string; filename: string; tmpDir: string };

type ExportManifest = {
  createdAt: string;
  version: string;
  files: Array<{ name: string; md5: string; size: number }>;
  excludedKvTables: string[];
  schema?: { tables: string[]; views: string[] };
};

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function isAuthorizedExportRequest(opts: {
  authorizationHeader?: string;
  sharedSecret: string;
}) {
  const { authorizationHeader, sharedSecret } = opts;
  if (!sharedSecret) return false;
  if (!authorizationHeader) return false;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualString(match[1]!, sharedSecret);
}

async function sqliteBackup({ sourcePath, destPath }: { sourcePath: string; destPath: string }) {
  const db = new DatabaseSync(sourcePath, { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA mmap_size = 0; PRAGMA cache_size = -2048");
    // VACUUM INTO copies the database to a new file (SQLite 3.27+)
    const escaped = path.resolve(destPath).replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
}

function shouldExcludeTable(name: string): boolean {
  return name === "auth_sessions" || name === "auth_state" || name.startsWith("auth_");
}

async function createSanitizedKvCopy({
  sourcePath,
  destPath,
  checkCancelled,
}: {
  sourcePath: string;
  destPath: string;
  checkCancelled: () => void;
}) {
  const src = new DatabaseSync(sourcePath, { readonly: true });
  const dest = new DatabaseSync(destPath);

  try {
    src.exec("PRAGMA busy_timeout = 10000");
    dest.exec("PRAGMA busy_timeout = 5000");
    src.exec("PRAGMA mmap_size = 0; PRAGMA cache_size = -2048");
    dest.exec("PRAGMA mmap_size = 0; PRAGMA cache_size = -2048");

    const objects = src
      .prepare(
        `
        SELECT type, name, tbl_name as tblName, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
        ORDER BY
          CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 WHEN 'view' THEN 3 ELSE 4 END,
          name
      `,
      )
      .all() as Array<{
      type: string;
      name: string;
      tblName: string;
      sql: string;
    }>;

    const tablesToCopy: Array<{
      name: string;
      colList: string;
      colNames: string[];
      quotedTable: string;
    }> = [];
    const tableSql: string[] = [];
    const otherSql: string[] = [];

    for (const obj of objects) {
      const name = obj.name;
      const tbl = obj.tblName;
      if (obj.type === "table") {
        if (name.startsWith("sqlite_")) continue;
        if (shouldExcludeTable(name)) continue;
        tableSql.push(obj.sql);
        const quotedTable = `"${name.replace(/"/g, '""')}"`;
        const cols = src.prepare(`PRAGMA table_info(${quotedTable})`).all() as Array<{
          name: string;
        }>;
        if (cols.length === 0) {
          throw new Error(`Failed to retrieve column info for table: ${name}`);
        }
        tablesToCopy.push({
          name,
          colList: cols.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", "),
          colNames: cols.map((c) => c.name),
          quotedTable,
        });
        continue;
      }
      if (tbl && shouldExcludeTable(tbl)) continue;
      otherSql.push(obj.sql);
    }

    dest.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of tableSql) {
        dest.exec(sql);
      }

      // Copy data by reading from src and inserting into dest (no ATTACH —
      // the app may have the source DB open, which would lock it)
      for (const { name, colList, colNames, quotedTable } of tablesToCopy) {
        checkCancelled();
        const rows = src.prepare(`SELECT ${colList} FROM ${quotedTable}`).iterate() as Iterable<
          Record<string, unknown>
        >;
        const placeholders = colNames.map(() => "?").join(", ");
        const safeName = `"${name.replace(/"/g, '""')}"`;
        const insert = dest.prepare(
          `INSERT INTO main.${safeName} (${colList}) VALUES (${placeholders})`,
        );
        for (const row of rows) {
          checkCancelled();
          insert.run(...colNames.map((col) => row[col] as string | number | bigint | null));
        }
      }

      for (const sql of otherSql) {
        dest.exec(sql);
      }

      dest.exec("COMMIT");
    } catch (e) {
      dest.exec("ROLLBACK");
      throw new Error(`Failed to create sanitized KV copy: ${toError(e).message}`);
    }

    checkCancelled();
    dest.exec("VACUUM");
  } finally {
    src.close();
    dest.close();
  }
}

function createTgz(cwd: string, outputFile: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-czf", outputFile, "-C", cwd, ...files], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8192);
    });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`tar exited ${code}: ${stderr.trim() || "no stderr"}`)),
    );
  });
}

export function createTgzReadStream(
  cwd: string,
  files: string[],
  callbacks?: { onClose?: () => void; onError?: (err: Error) => void },
): ReadableStream<Uint8Array> {
  const download = startTgzDownload(cwd, files);
  void download.done.then((error) =>
    error ? callbacks?.onError?.(error) : callbacks?.onClose?.(),
  );
  return download.stream;
}

/** Completion means both the consumer and tar are finished, not merely stdout EOF. */
export function startTgzDownload(
  cwd: string,
  files: string[],
  signal?: AbortSignal,
): { stream: ReadableStream<Uint8Array>; done: Promise<Error | undefined> } {
  const proc = spawn("tar", ["-czf", "-", "-C", cwd, ...files], {
    stdio: ["ignore", "pipe", "pipe"],
    // GNU tar starts gzip as a child. Cancel the whole private process group,
    // not just tar, or gzip can outlive the disconnected download.
    detached: process.platform !== "win32",
  });
  let stderr = "";
  let processError: Error | undefined;
  proc.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-8192);
  });
  proc.on("error", (error) => {
    processError = error;
  });
  const closed = new Promise<Error | undefined>((resolve) => {
    proc.on("close", (code) =>
      resolve(
        processError ??
          (code === 0
            ? undefined
            : new Error(`tar exited ${code}: ${stderr.trim() || "no stderr"}`)),
      ),
    );
  });
  const reader = (
    Readable.toWeb(proc.stdout, {
      strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
    }) as unknown as ReadableStream<Uint8Array>
  ).getReader();
  let settle!: (error: Error | undefined) => void;
  const done = new Promise<Error | undefined>((resolve) => {
    settle = resolve;
  });
  let finishing: Promise<void> | undefined;
  let cancelled = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const finish = (error?: Error): Promise<void> => {
    if (finishing) return finishing;
    finishing = (async () => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        if (process.platform !== "win32" && proc.pid) {
          try {
            process.kill(-proc.pid, "SIGKILL");
          } catch {
            proc.kill("SIGKILL");
          }
        } else proc.kill("SIGKILL");
        await reader.cancel(error).catch(() => {});
      }
      const childError = await closed;
      settle(error ?? childError);
      if (!error && !cancelled) {
        if (childError) controller.error(childError);
        else controller.close();
      }
    })();
    return finishing;
  };
  const abort = () => {
    cancelled = true;
    const error = new Error("Export download cancelled");
    if (!finishing) controller.error(error);
    void finish(error);
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      },
      async pull(value) {
        try {
          const next = await reader.read();
          if (finishing) return;
          if (next.done) await finish();
          else value.enqueue(next.value);
        } catch (error) {
          if (finishing) return;
          value.error(error);
          await finish(toError(error));
        }
      },
      cancel() {
        cancelled = true;
        return finish(new Error("Export download cancelled"));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, done };
}

async function computeFileMd5(filePath: string, checkCancelled: () => void): Promise<string> {
  const hash = crypto.createHash("md5");
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    checkCancelled();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function getFileStats(
  filePath: string,
  checkCancelled: () => void,
): Promise<{ md5: string; size: number }> {
  const { size } = await fsp.stat(filePath);
  return { md5: await computeFileMd5(filePath, checkCancelled), size };
}

export type PrepareResult = {
  tmpDir: string;
  filename: string;
  files: string[];
};

export type ExportOptions = {
  dbPath: string;
  kvPath?: string;
  exportDir: string;
  includeKv: boolean;
};

export function exportJobPaths(exportDir: string): PrepareResult {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = crypto.randomUUID();
  return {
    tmpDir: path.join(exportDir, `bookhive-export-${stamp}-${runId}`),
    filename: `bookhive-export-${stamp}-${runId.slice(0, 8)}.tgz`,
    files: [],
  };
}

// The caller records this private job directory before starting a Worker. Never
// sweep other jobs here: another process may still be writing or streaming one.
export async function prepareSanitizedExportFiles(
  opts: ExportOptions,
  job = exportJobPaths(opts.exportDir),
  checkCancelled: () => void = () => {},
): Promise<PrepareResult> {
  const { dbPath, kvPath, includeKv } = opts;
  const now = new Date();
  const { tmpDir, filename } = job;
  checkCancelled();

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create export temporary directory at ${tmpDir}: ${toError(err).message}`,
    );
  }

  try {
    const dbOut = path.join(tmpDir, "db.sqlite");
    try {
      await sqliteBackup({ sourcePath: dbPath, destPath: dbOut });
    } catch (err) {
      throw new Error(`Failed to backup main database from ${dbPath}: ${toError(err).message}`);
    }

    const includedFiles: ExportManifest["files"] = [];
    const tables: string[] = [];
    const views: string[] = [];

    checkCancelled();
    const dbStats = await getFileStats(dbOut, checkCancelled);
    includedFiles.push({ name: "db.sqlite", md5: dbStats.md5, size: dbStats.size });

    try {
      const db = new DatabaseSync(dbOut, { readonly: true });
      try {
        const schemaObjects = db
          .prepare(
            `SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`,
          )
          .all() as Array<{ type: string; name: string }>;
        for (const obj of schemaObjects) {
          (obj.type === "table" ? tables : views).push(obj.name);
        }
      } finally {
        db.close();
      }
    } catch (err) {
      throw new Error(
        `Failed to extract schema information from main database: ${toError(err).message}`,
      );
    }

    if (includeKv && kvPath) {
      const kvOut = path.join(tmpDir, "kv.sqlite");
      try {
        await createSanitizedKvCopy({ sourcePath: kvPath, destPath: kvOut, checkCancelled });
      } catch (err) {
        throw new Error(
          `Failed to create sanitized KV copy from ${kvPath}: ${toError(err).message}`,
        );
      }
      const kvStats = await getFileStats(kvOut, checkCancelled);
      includedFiles.push({ name: "kv.sqlite", md5: kvStats.md5, size: kvStats.size });
    }

    const manifest: ExportManifest = {
      createdAt: now.toISOString(),
      version: "1.0",
      files: includedFiles,
      excludedKvTables: ["auth_sessions", "auth_state"],
      schema: { tables, views },
    };

    const manifestPath = path.join(tmpDir, "manifest.json");
    try {
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    } catch (err) {
      throw new Error(`Failed to write manifest file: ${toError(err).message}`);
    }

    const manifestStats = await getFileStats(manifestPath, checkCancelled);
    includedFiles.push({ name: "manifest.json", md5: manifestStats.md5, size: manifestStats.size });

    return { tmpDir, filename, files: includedFiles.map((f) => f.name) };
  } catch (err) {
    await cleanupExportPaths({ tmpDir });
    throw err;
  }
}

export async function createSanitizedExportArchive(opts: ExportOptions): Promise<ExportResult> {
  const prepared = await prepareSanitizedExportFiles(opts);
  const { tmpDir, filename, files } = prepared;
  const archivePath = path.join(opts.exportDir, filename);
  try {
    await createTgz(tmpDir, archivePath, files);
    return { archivePath, filename, tmpDir };
  } catch (err) {
    await cleanupExportPaths({ archivePath, tmpDir });
    throw err;
  }
}

export async function cleanupExportPaths(paths: {
  archivePath?: string;
  tmpDir?: string;
}): Promise<void> {
  const promises: Promise<unknown>[] = [];
  if (paths.archivePath) promises.push(fsp.rm(paths.archivePath, { force: true }));
  if (paths.tmpDir) promises.push(fsp.rm(paths.tmpDir, { recursive: true, force: true }));
  await Promise.allSettled(promises);
}

export function createExportReadStream(
  filePath: string,
  callbacks?: { onClose?: () => void; onError?: (err: Error) => void },
): ReadableStream<Uint8Array> {
  const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
  stream.on("close", () => callbacks?.onClose?.());
  stream.on("error", (err) => callbacks?.onError?.(err));
  return Readable.toWeb(stream, {
    strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
  }) as unknown as ReadableStream<Uint8Array>;
}
