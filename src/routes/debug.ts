import inspector from "node:inspector";
import os from "node:os";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { AppEnv } from "../context";
import { env } from "../env";
import { isAuthorizedExportRequest } from "../utils/dbExport";

let isProfilingActive = false;

const debug = new Hono<AppEnv>()
  // Auth middleware for all /debug/* routes
  .use("*", async (c, next) => {
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404) as never;
    }
    await next();
  })

  .get("/heap-snapshot", (c) => {
    const timestamp = Date.now();
    const snapshot = Bun.generateHeapSnapshot("v8");

    return c.body(snapshot, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="heap-${timestamp}.heapsnapshot"`,
      "Cache-Control": "no-store",
    });
  })

  .get(
    "/cpu-profile",
    zValidator(
      "query",
      z.object({
        duration: z.coerce.number().int().min(1).max(120).default(30),
      }),
    ),
    async (c) => {
      if (isProfilingActive) {
        return c.json({ message: "A CPU profile is already in progress" }, 409);
      }

      const { duration } = c.req.valid("query");
      isProfilingActive = true;

      try {
        const session = new inspector.Session();
        session.connect();

        const post = (method: string, params?: Record<string, unknown>) =>
          new Promise<Record<string, unknown>>((resolve, reject) => {
            session.post(method, params, (err: Error | null, result: unknown) => {
              if (err) reject(err);
              else resolve(result as Record<string, unknown>);
            });
          });

        await post("Profiler.enable");
        await post("Profiler.start");

        await new Promise((resolve) => setTimeout(resolve, duration * 1000));

        const { profile } = await post("Profiler.stop");
        await post("Profiler.disable");
        session.disconnect();

        const timestamp = Date.now();
        return c.json(profile, 200, {
          "Content-Disposition": `attachment; filename="cpu-${timestamp}.cpuprofile"`,
          "Cache-Control": "no-store",
        });
      } finally {
        isProfilingActive = false;
      }
    },
  )

  .get("/memory", (c) => {
    const mem = process.memoryUsage();
    return c.json({
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      uptimeSeconds: process.uptime(),
      cpuCount: os.cpus().length,
    });
  })

  .post("/gc", (c) => {
    const before = process.memoryUsage();
    Bun.gc(true);
    const after = process.memoryUsage();

    return c.json({
      before: {
        rss: before.rss,
        heapTotal: before.heapTotal,
        heapUsed: before.heapUsed,
      },
      after: {
        rss: after.rss,
        heapTotal: after.heapTotal,
        heapUsed: after.heapUsed,
      },
      freed: {
        rss: before.rss - after.rss,
        heapTotal: before.heapTotal - after.heapTotal,
        heapUsed: before.heapUsed - after.heapUsed,
      },
    });
  });

export default debug;
