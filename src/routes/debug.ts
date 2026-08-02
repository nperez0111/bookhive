import inspector from "node:inspector";
import os from "node:os";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { AppEnv } from "../context";
import { env } from "../env";
import { isAuthorizedExportRequest } from "../utils/dbExport";
import { restoreGuardStates } from "../auth/restore-guard";

let isProfilingActive = false;

/** Parsed /proc/self/smaps_rollup, or null off Linux (macOS dev). */
function readSmapsRollup(): Record<string, number> | null {
  try {
    const text = readFileSync("/proc/self/smaps_rollup", "utf8");
    const out: Record<string, number> = {};
    for (const line of text.split("\n")) {
      const m = /^(\w+):\s+(\d+) kB$/.exec(line);
      if (m?.[1] && m[2]) out[m[1]] = Number(m[2]);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Resident mappings over 20 MB, largest first — attributes RSS to real files. */
function readLargestMappings(limit = 12): Array<{ rssKb: number; path: string }> | null {
  try {
    const text = readFileSync("/proc/self/smaps", "utf8");
    const out: Array<{ rssKb: number; path: string }> = [];
    let path = "[anon]";
    for (const line of text.split("\n")) {
      const header = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
      if (header) {
        path = header[1]?.trim() || "[anon]";
        continue;
      }
      const rss = /^Rss:\s+(\d+) kB$/.exec(line);
      if (rss?.[1]) {
        const rssKb = Number(rss[1]);
        if (rssKb > 20_000) out.push({ rssKb, path });
      }
    }
    return out.sort((a, b) => b.rssKb - a.rssKb).slice(0, limit);
  } catch {
    return null;
  }
}

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

  /**
   * Per-process memory, broken down the way the OOM investigation actually
   * needed it.
   *
   * `ps`/`RSS` counts the ~1 GB clean, shared, file-backed SQLite mmap, which
   * is reclaimable — that term is why per-worker RSS readings looked like a
   * 1.2-1.4 GB "balloon rotating between workers" when the real anonymous
   * footprint was ~320 MB. `Anonymous` from smaps_rollup is the number that
   * matters, and `mappings` attributes the rest to actual files.
   */
  .get("/memory", (c) => {
    const mem = process.memoryUsage();
    return c.json(
      {
        worker: env.WORKER_INDEX || "solo",
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        cpuCount: os.cpus().length,
        // Under Bun these are JSC values: heapTotal is not a bound on heapUsed.
        // `external`/`arrayBuffers` are the native, off-heap bytes.
        memoryUsage: mem,
        nonHeapBytes: mem.rss - mem.heapUsed,
        smapsRollup: readSmapsRollup(),
        mappings: readLargestMappings(),
        pdsBreakers: restoreGuardStates().filter((s) => s.state !== "closed"),
      },
      200,
      { "Cache-Control": "no-store" },
    );
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
      const abortSignal = c.req.raw.signal;
      isProfilingActive = true;

      const session = new inspector.Session();
      try {
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

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, duration * 1000);
          abortSignal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Client disconnected", "AbortError"));
            },
            { once: true },
          );
        });

        if (abortSignal.aborted) {
          throw new DOMException("Client disconnected", "AbortError");
        }

        const { profile } = await post("Profiler.stop");
        await post("Profiler.disable");
        session.disconnect();

        const timestamp = Date.now();
        return c.json(profile, 200, {
          "Content-Disposition": `attachment; filename="cpu-${timestamp}.cpuprofile"`,
          "Cache-Control": "no-store",
        });
      } catch (err) {
        // Always stop the profiler cleanly on any error
        try {
          const quietPost = (method: string) =>
            new Promise<void>((resolve) => {
              session.post(method, {}, () => resolve());
            });
          await quietPost("Profiler.stop");
          await quietPost("Profiler.disable");
          session.disconnect();
        } catch {
          // Best-effort cleanup
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          return c.json({ message: "Profile aborted: client disconnected" }, 408);
        }
        throw err;
      } finally {
        isProfilingActive = false;
      }
    },
  )

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
