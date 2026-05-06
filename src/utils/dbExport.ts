import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

type ExportResult = { archivePath: string; filename: string; tmpDir: string };

type ExportManifest = {
  createdAt: string;
  version: string;
  files: Array<{ name: string; md5: string; size: number }>;
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

/** Run pg_dump and write the output to a file. */
async function pgDumpBackup({
  databaseUrl,
  destPath,
  excludeTables,
}: {
  databaseUrl: string;
  destPath: string;
  excludeTables?: string[];
}): Promise<void> {
  const args = ["--format=custom", "--file", destPath];
  for (const table of excludeTables ?? []) {
    args.push("--exclude-table", table);
  }
  args.push(databaseUrl);

  return new Promise((resolve, reject) => {
    const proc = spawn("pg_dump", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: string[] = [];
    proc.stderr.on("data", (d) => stderr.push(d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pg_dump exited ${code}: ${stderr.join("").trim() || "no stderr"}`)),
    );
  });
}

function createTgz(cwd: string, outputFile: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-czf", outputFile, "-C", cwd, ...files], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: string[] = [];
    proc.stderr.on("data", (d) => stderr.push(d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`tar exited ${code}: ${stderr.join("").trim() || "no stderr"}`)),
    );
  });
}

export function createTgzReadStream(
  cwd: string,
  files: string[],
  callbacks?: { onClose?: () => void; onError?: (err: Error) => void },
): ReadableStream<Uint8Array> {
  const proc = spawn("tar", ["-czf", "-", "-C", cwd, ...files], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  if (proc.stderr) {
    proc.stderr.on("data", (d: Buffer) => stderr.push(d.toString()));
  }
  proc.on("error", (err: Error) => callbacks?.onError?.(err));
  proc.on("close", (code: number | null) => {
    if (code === 0) {
      callbacks?.onClose?.();
    } else {
      callbacks?.onError?.(
        new Error(`tar exited ${code}: ${stderr.join("").trim() || "no stderr"}`),
      );
    }
  });
  return Readable.toWeb(proc.stdout!) as unknown as ReadableStream<Uint8Array>;
}

function computeFileMd5(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

async function getFileStats(filePath: string): Promise<{ md5: string; size: number }> {
  const { size } = await fsp.stat(filePath);
  return { md5: computeFileMd5(filePath), size };
}

type PrepareResult = {
  tmpDir: string;
  filename: string;
  files: string[];
};

export async function prepareSanitizedExportFiles(opts: {
  databaseUrl: string;
  exportDir: string;
}): Promise<PrepareResult> {
  const { databaseUrl, exportDir } = opts;

  await cleanupStaleExports(exportDir);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = crypto.randomUUID();
  const tmpDir = path.join(exportDir, `bookhive-export-${stamp}-${runId}`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create export temporary directory at ${tmpDir}: ${toError(err).message}`,
    );
  }

  const filename = `bookhive-export-${stamp}-${runId.slice(0, 8)}.tgz`;

  try {
    const dbOut = path.join(tmpDir, "db.dump");
    try {
      await pgDumpBackup({
        databaseUrl,
        destPath: dbOut,
        excludeTables: ["kv_auth_sessions", "kv_auth_state"],
      });
    } catch (err) {
      throw new Error(`Failed to backup database: ${toError(err).message}`);
    }

    const includedFiles: ExportManifest["files"] = [];

    const dbStats = await getFileStats(dbOut);
    includedFiles.push({ name: "db.dump", md5: dbStats.md5, size: dbStats.size });

    const manifest: ExportManifest = {
      createdAt: now.toISOString(),
      version: "2.0",
      files: includedFiles,
    };

    const manifestPath = path.join(tmpDir, "manifest.json");
    try {
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    } catch (err) {
      throw new Error(`Failed to write manifest file: ${toError(err).message}`);
    }

    const manifestStats = await getFileStats(manifestPath);
    includedFiles.push({ name: "manifest.json", md5: manifestStats.md5, size: manifestStats.size });

    return { tmpDir, filename, files: includedFiles.map((f) => f.name) };
  } catch (err) {
    await cleanupExportPaths({ tmpDir });
    throw err;
  }
}

export async function createSanitizedExportArchive(opts: {
  databaseUrl: string;
  exportDir: string;
}): Promise<ExportResult> {
  const { databaseUrl, exportDir } = opts;

  await cleanupStaleExports(exportDir);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = crypto.randomUUID();
  const tmpDir = path.join(exportDir, `bookhive-export-${stamp}-${runId}`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create export temporary directory at ${tmpDir}: ${toError(err).message}`,
    );
  }

  const filename = `bookhive-export-${stamp}-${runId.slice(0, 8)}.tgz`;
  const archivePath = path.join(exportDir, filename);

  try {
    const dbOut = path.join(tmpDir, "db.dump");
    try {
      await pgDumpBackup({
        databaseUrl,
        destPath: dbOut,
        excludeTables: ["kv_auth_sessions", "kv_auth_state"],
      });
    } catch (err) {
      throw new Error(`Failed to backup database: ${toError(err).message}`);
    }

    const includedFiles: ExportManifest["files"] = [];

    const dbStats = await getFileStats(dbOut);
    includedFiles.push({ name: "db.dump", md5: dbStats.md5, size: dbStats.size });

    const manifest: ExportManifest = {
      createdAt: now.toISOString(),
      version: "2.0",
      files: includedFiles,
    };

    const manifestPath = path.join(tmpDir, "manifest.json");
    try {
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    } catch (err) {
      throw new Error(`Failed to write manifest file: ${toError(err).message}`);
    }

    const manifestStats = await getFileStats(manifestPath);
    includedFiles.push({ name: "manifest.json", md5: manifestStats.md5, size: manifestStats.size });

    try {
      await createTgz(
        tmpDir,
        archivePath,
        includedFiles.map((f) => f.name),
      );
    } catch (err) {
      throw new Error(`Failed to create tar archive: ${toError(err).message}`);
    }

    return { archivePath, filename, tmpDir };
  } catch (err) {
    await cleanupExportPaths({ archivePath, tmpDir });
    throw err;
  }
}

async function cleanupStaleExports(exportDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(exportDir);
  } catch {
    return; // exportDir doesn't exist yet — nothing to clean
  }
  const stale = entries.filter((e) => e.startsWith("bookhive-export-"));
  await Promise.allSettled(
    stale.map((e) => fsp.rm(path.join(exportDir, e), { recursive: true, force: true })),
  );
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
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
