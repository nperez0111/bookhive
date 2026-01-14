import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import Database from "better-sqlite3";

type ExportResult = {
  archivePath: string;
  filename: string;
  tmpDir: string;
};

function timingSafeEqualString(a: string, b: string) {
  // Avoid timing attacks and length-leak fast path
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against itself so runtime is similar-ish
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

function shouldExcludeTable(name: string) {
  if (name === "auth_sessions" || name === "auth_state") return true;
  if (name.startsWith("auth_")) return true;
  return false;
}

async function createSanitizedKvCopy({
  sourcePath,
  destPath,
}: {
  sourcePath: string;
  destPath: string;
}) {
  const src = new Database(sourcePath, { fileMustExist: true, readonly: true });
  const dest = new Database(destPath, { fileMustExist: false });
  try {
    src.pragma("busy_timeout = 5000");
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
      .all() as Array<{ type: string; name: string; tblName: string; sql: string }>;

    const tablesToCopy: string[] = [];
    const tableSql: string[] = [];
    const otherSql: string[] = [];

    for (const obj of objects) {
      const name = obj.name;
      const tbl = obj.tblName;
      if (obj.type === "table") {
        if (name.startsWith("sqlite_")) continue;
        if (shouldExcludeTable(name)) continue;
        tableSql.push(obj.sql);
        tablesToCopy.push(name);
        continue;
      }
      // Skip indexes/triggers/views attached to excluded tables
      if (tbl && shouldExcludeTable(tbl)) continue;
      otherSql.push(obj.sql);
    }

    dest.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of tableSql) {
        dest.exec(sql);
      }

      // Copy table data by attaching the source DB
      dest.prepare("ATTACH DATABASE ? AS src").run(sourcePath);
      try {
        for (const table of tablesToCopy) {
          const cols = src
            .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
            .all() as Array<{ name: string }>;
          const colList = cols.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", ");
          dest.exec(
            `INSERT INTO "${table.replace(/"/g, '""')}" (${colList}) SELECT ${colList} FROM src."${table.replace(/"/g, '""')}"`,
          );
        }
      } finally {
        dest.exec("DETACH DATABASE src");
      }

      for (const sql of otherSql) {
        dest.exec(sql);
      }

      dest.exec("COMMIT");
    } catch (e) {
      dest.exec("ROLLBACK");
      throw e;
    }

    // Ensure the output DB is compact and doesn't contain remnants of excluded data
    dest.exec("VACUUM");
  } finally {
    src.close();
    dest.close();
  }
}

async function createTgz({
  cwd,
  outputFile,
  files,
}: {
  cwd: string;
  outputFile: string;
  files: string[];
}) {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-czf", outputFile, "-C", cwd, ...files], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`tar exited with code ${code}: ${err}`));
    });
  });
}

export async function createSanitizedExportArchive(opts: {
  dbPath: string;
  kvPath?: string;
  exportDir: string;
  includeKv: boolean;
}) : Promise<ExportResult> {
  const { dbPath, kvPath, exportDir, includeKv } = opts;

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = crypto.randomUUID();
  const tmpDir = path.join(exportDir, `bookhive-export-${stamp}-${runId}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const filename = `bookhive-export-${stamp}-${runId.slice(0, 8)}.tgz`;
  const archivePath = path.join(exportDir, filename);

  try {
    const dbOut = path.join(tmpDir, "db.sqlite");
    await sqliteBackup({ sourcePath: dbPath, destPath: dbOut });

    const includedFiles = ["db.sqlite"];

    if (includeKv && kvPath) {
      const kvOut = path.join(tmpDir, "kv.sqlite");
      await createSanitizedKvCopy({ sourcePath: kvPath, destPath: kvOut });
      includedFiles.push("kv.sqlite");
    }

    const manifest = {
      createdAt: now.toISOString(),
      files: includedFiles,
      excludedKvTables: ["auth_sessions", "auth_state"],
    };
    await fsp.writeFile(
      path.join(tmpDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    includedFiles.push("manifest.json");

    await createTgz({ cwd: tmpDir, outputFile: archivePath, files: includedFiles });

    return { archivePath, filename, tmpDir };
  } catch (err) {
    await cleanupExportPaths({ archivePath, tmpDir });
    throw err;
  }
}

export async function cleanupExportPaths(paths: {
  archivePath?: string;
  tmpDir?: string;
}) {
  const { archivePath, tmpDir } = paths;
  await Promise.allSettled([
    archivePath ? fsp.rm(archivePath, { force: true }) : Promise.resolve(),
    tmpDir ? fsp.rm(tmpDir, { recursive: true, force: true }) : Promise.resolve(),
  ]);
}

export function createExportReadStream(filePath: string) {
  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return { nodeStream, webStream };
}

