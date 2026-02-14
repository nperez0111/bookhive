import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";

import type { AppEnv } from "../context";
import { env } from "../env";
import {
  cleanupExportPaths,
  createExportReadStream,
  createSanitizedExportArchive,
  isAuthorizedExportRequest,
} from "../utils/dbExport";

const admin = new Hono<AppEnv>().get("/export", async (c) => {
  const ctx = c.get("ctx");
  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  try {
    if (!env.EXPORT_SHARED_SECRET) {
      ctx.logger.warn(
        { ip: clientIp, reason: "endpoint_not_configured" },
        "export endpoint access attempt - endpoint disabled",
      );
      return c.json({ message: "Not Found" }, 404);
    }

    const authorization = c.req.header("authorization");
    if (
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      ctx.logger.warn(
        { ip: clientIp, reason: "invalid_authorization" },
        "export endpoint unauthorized access attempt",
      );
      return c.json({ message: "Not Found" }, 404);
    }

    if (!env.DB_PATH || env.DB_PATH === ":memory:") {
      ctx.logger.error(
        { ip: clientIp, dbPath: env.DB_PATH },
        "export endpoint called but DB_PATH is not a file path",
      );
      return c.json(
        { message: "DB exports require DB_PATH to be a file path" },
        400,
      );
    }

    const exportDir =
      env.DB_EXPORT_DIR?.trim() ||
      path.join(path.dirname(env.DB_PATH), "exports");

    ctx.logger.info({ ip: clientIp, exportDir }, "starting database export");

    const startTimeExport = Date.now();
    let result: {
      archivePath: string;
      tmpDir: string;
      filename: string;
    };

    try {
      await fs.promises.mkdir(exportDir, { recursive: true });

      const includeKv =
        Boolean(env.KV_DB_PATH) &&
        env.KV_DB_PATH !== ":memory:" &&
        fs.existsSync(env.KV_DB_PATH);

      result = await createSanitizedExportArchive({
        dbPath: env.DB_PATH,
        kvPath: includeKv ? env.KV_DB_PATH : undefined,
        exportDir,
        includeKv,
      });
    } catch (err) {
      const duration = Date.now() - startTimeExport;
      ctx.logger.error(
        {
          ip: clientIp,
          duration,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        "database export failed",
      );
      return c.json({ message: "Failed to create export archive" }, 500);
    }

    const duration = Date.now() - startTimeExport;
    const stream = createExportReadStream(result.archivePath, {
      onClose: () => {
        ctx.logger.info(
          { ip: clientIp, filename: result.filename, duration },
          "database export completed successfully",
        );
        cleanupExportPaths({
          archivePath: result.archivePath,
          tmpDir: result.tmpDir,
        });
      },
      onError: (err) => {
        ctx.logger.error(
          { ip: clientIp, filename: result.filename, error: err.message },
          "error streaming export file",
        );
        cleanupExportPaths({
          archivePath: result.archivePath,
          tmpDir: result.tmpDir,
        });
      },
    });

    return c.body(stream, 200, {
      "Content-Type": "application/gzip",
      "Content-Encoding": "gzip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    });
  } catch (err) {
    ctx.logger.error(
      {
        ip: clientIp,
        error: err instanceof Error ? err.message : String(err),
      },
      "unexpected error in export endpoint",
    );
    return c.json({ message: "Internal server error" }, 500);
  }
});

export default admin;
