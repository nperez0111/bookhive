import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";

import type { AppEnv } from "../context";
import { env } from "../env";
import {
  cleanupExportPaths,
  createTgzReadStream,
  prepareSanitizedExportFiles,
  isAuthorizedExportRequest,
} from "../utils/dbExport";
import { backfillCatalogBooks, getBackfillProgress } from "../utils/catalogBookService";

const admin = new Hono<AppEnv>()
  .post("/backfill-catalog", async (c) => {
    const ctx = c.get("ctx");
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404);
    }

    if (!ctx.serviceAccountAgent) {
      return c.json({ message: "Service account not configured" }, 503);
    }

    const logger = c.get("appLogger");
    // Run in background — do not await
    backfillCatalogBooks({ ...ctx, logger }).catch((err) => {
      logger.error({ err }, "[backfill-catalog] Backfill failed");
    });

    ctx.addWideEventContext({ backfill_catalog: "started" });
    return c.json({ message: "Backfill started" }, 202);
  })
  .get("/backfill-catalog/progress", (c) => {
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404);
    }

    return c.json(getBackfillProgress());
  })
  .get("/export", async (c) => {
    const ctx = c.get("ctx");
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    try {
      if (!env.EXPORT_SHARED_SECRET) {
        ctx.addWideEventContext({
          admin_export: "rejected",
          client_ip: clientIp,
          reason: "endpoint_not_configured",
        });
        return c.json({ message: "Not Found" }, 404);
      }

      const authorization = c.req.header("authorization");
      if (
        !isAuthorizedExportRequest({
          authorizationHeader: authorization,
          sharedSecret: env.EXPORT_SHARED_SECRET,
        })
      ) {
        ctx.addWideEventContext({
          admin_export: "rejected",
          client_ip: clientIp,
          reason: "invalid_authorization",
        });
        return c.json({ message: "Not Found" }, 404);
      }

      if (!env.DB_PATH || env.DB_PATH === ":memory:") {
        ctx.addWideEventContext({
          admin_export: "invalid",
          client_ip: clientIp,
          db_path: env.DB_PATH,
        });
        return c.json({ message: "DB exports require DB_PATH to be a file path" }, 400);
      }

      const exportDir =
        env.DB_EXPORT_DIR?.trim() || path.join(path.dirname(env.DB_PATH), "exports");

      ctx.addWideEventContext({
        admin_export: "started",
        client_ip: clientIp,
        export_dir: exportDir,
      });

      const startTimeExport = Date.now();
      let prepared: {
        tmpDir: string;
        filename: string;
        files: string[];
      };

      try {
        await fs.promises.mkdir(exportDir, { recursive: true });

        const includeKv =
          Boolean(env.KV_DB_PATH) && env.KV_DB_PATH !== ":memory:" && fs.existsSync(env.KV_DB_PATH);

        prepared = await prepareSanitizedExportFiles({
          dbPath: env.DB_PATH,
          kvPath: includeKv ? env.KV_DB_PATH : undefined,
          exportDir,
          includeKv,
        });
      } catch (err) {
        const duration = Date.now() - startTimeExport;
        c.set("requestError", err);
        ctx.addWideEventContext({
          admin_export: "failed",
          client_ip: clientIp,
          duration_ms: duration,
        });
        return c.json({ message: "Failed to create export archive" }, 500);
      }

      // Stream tar stdout directly to the response so bytes start flowing
      // immediately, avoiding proxy timeouts on large databases.
      const stream = createTgzReadStream(prepared.tmpDir, prepared.files, {
        onClose: () => {
          const duration = Date.now() - startTimeExport;
          ctx.addWideEventContext({
            admin_export: "completed",
            client_ip: clientIp,
            filename: prepared.filename,
            duration_ms: duration,
          });
          void cleanupExportPaths({ tmpDir: prepared.tmpDir });
        },
        onError: (err) => {
          ctx.addWideEventContext({
            admin_export_stream: "error",
            client_ip: clientIp,
            filename: prepared.filename,
            error: err.message,
          });
          void cleanupExportPaths({ tmpDir: prepared.tmpDir });
        },
      });

      return c.body(stream, 200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${prepared.filename}"`,
        "Cache-Control": "no-store",
      });
    } catch (err) {
      c.set("requestError", err);
      ctx.addWideEventContext({
        admin_export: "error",
        client_ip: clientIp,
      });
      return c.json({ message: "Internal server error" }, 500);
    }
  });

export default admin;
