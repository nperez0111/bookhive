import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import Database from "better-sqlite3";

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
  return timingSafeEqualString(match[1], sharedSecret);
}

async function sqliteBackup({
  sourcePath,
  destPath,
}: {
  sourcePath: string;
  destPath: string;
}) {
  const db = new Database(sourcePath, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    await db.backup(destPath);
  } finally {
    db.close();
  }
}

function shouldExcludeTable(name: string): boolean {
  return (
    name === "auth_sessions" ||
    name === "auth_state" ||
    name.startsWith("auth_")
  );
}

async function createSanitizedKvCopy({
  sourcePath,
  destPath,
}: {
  sourcePath: string;
  destPath: string;
}) {
  const src = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  const dest = new Database(destPath, { fileMustExist: false });

  try {
    src.pragma("busy_timeout = 10000");
    dest.pragma("busy_timeout = 5000");

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
        const cols = src
          .prepare(`PRAGMA table_info(${quotedTable})`)
          .all() as Array<{ name: string }>;
        if (cols.length === 0) {
          throw new Error(`Failed to retrieve column info for table: ${name}`);
        }
        tablesToCopy.push({
          name,
          colList: cols.map((c) => `"${c.name}"`).join(", "),
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
        const rows = src
          .prepare(`SELECT ${colList} FROM ${quotedTable}`)
          .all() as Record<string, unknown>[];
        if (rows.length === 0) continue;
        const placeholders = colNames.map(() => "?").join(", ");
        const safeName = `"${name.replace(/"/g, '""')}"`;
        const insert = dest.prepare(
          `INSERT INTO main.${safeName} (${colList}) VALUES (${placeholders})`,
        );
        for (const row of rows) {
          insert.run(...colNames.map((col) => row[col]));
        }
      }

      for (const sql of otherSql) {
        dest.exec(sql);
      }

      dest.exec("COMMIT");
    } catch (e) {
      dest.exec("ROLLBACK");
      throw new Error(
        `Failed to create sanitized KV copy: ${toError(e).message}`,
      );
    }

    dest.exec("VACUUM");
  } finally {
    src.close();
    dest.close();
  }
}

function createTgz(
  cwd: string,
  outputFile: string,
  files: string[],
): Promise<void> {
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
        : reject(
            new Error(
              `tar exited ${code}: ${stderr.join("").trim() || "no stderr"}`,
            ),
          ),
    );
  });
}

function computeFileMd5(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

async function getFileStats(
  filePath: string,
): Promise<{ md5: string; size: number }> {
  const { size } = await fsp.stat(filePath);
  return { md5: computeFileMd5(filePath), size };
}

export async function createSanitizedExportArchive(opts: {
  dbPath: string;
  kvPath?: string;
  exportDir: string;
  includeKv: boolean;
}): Promise<ExportResult> {
  const { dbPath, kvPath, exportDir, includeKv } = opts;

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
    // Backup main database
    const dbOut = path.join(tmpDir, "db.sqlite");
    try {
      await sqliteBackup({ sourcePath: dbPath, destPath: dbOut });
    } catch (err) {
      throw new Error(
        `Failed to backup main database from ${dbPath}: ${toError(err).message}`,
      );
    }

    const includedFiles: ExportManifest["files"] = [];
    const tables: string[] = [];
    const views: string[] = [];

    // Add db.sqlite file info
    const dbStats = await getFileStats(dbOut);
    includedFiles.push({
      name: "db.sqlite",
      md5: dbStats.md5,
      size: dbStats.size,
    });

    // Extract schema info from main database
    try {
      const db = new Database(dbOut, { fileMustExist: true, readonly: true });
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

    // Handle KV database
    if (includeKv && kvPath) {
      const kvOut = path.join(tmpDir, "kv.sqlite");
      try {
        await createSanitizedKvCopy({ sourcePath: kvPath, destPath: kvOut });
      } catch (err) {
        throw new Error(
          `Failed to create sanitized KV copy from ${kvPath}: ${toError(err).message}`,
        );
      }

      const kvStats = await getFileStats(kvOut);
      includedFiles.push({
        name: "kv.sqlite",
        md5: kvStats.md5,
        size: kvStats.size,
      });
    }

    // Create and add manifest
    const manifest: ExportManifest = {
      createdAt: now.toISOString(),
      version: "1.0",
      files: includedFiles,
      excludedKvTables: ["auth_sessions", "auth_state"],
      schema: {
        tables,
        views,
      },
    };

    const manifestPath = path.join(tmpDir, "manifest.json");
    try {
      await fsp.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8",
      );
    } catch (err) {
      throw new Error(`Failed to write manifest file: ${toError(err).message}`);
    }

    const manifestStats = await getFileStats(manifestPath);
    includedFiles.push({
      name: "manifest.json",
      md5: manifestStats.md5,
      size: manifestStats.size,
    });

    // Create archive
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
    // Clean up on error
    await cleanupExportPaths({ archivePath, tmpDir });
    throw err;
  }
}

export async function cleanupExportPaths(paths: {
  archivePath?: string;
  tmpDir?: string;
}): Promise<void> {
  const promises: Promise<unknown>[] = [];
  if (paths.archivePath)
    promises.push(fsp.rm(paths.archivePath, { force: true }));
  if (paths.tmpDir)
    promises.push(fsp.rm(paths.tmpDir, { recursive: true, force: true }));
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
