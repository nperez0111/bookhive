/**
 * Multi-process supervisor — the production Docker CMD.
 *
 * Spawns WEB_CONCURRENCY (default 4) copies of the built server
 * (.output/server/index.mjs). All workers bind port 8080 via SO_REUSEPORT
 * (see server/entry.bun.mjs), so the kernel load-balances connections.
 *
 * Worker 0 is the primary: it runs DB migrations + VACUUM and the Jetstream
 * ingester (see isPrimaryWorker in src/context.ts). It is started alone and
 * must pass /healthcheck before the siblings spawn — that ordering is the
 * migration barrier for the non-primary workers.
 *
 * Not bundled — the Dockerfile copies this file verbatim and Bun runs the TS
 * source directly. Zero dependencies.
 */

const concurrency = Math.max(1, Number(process.env["WEB_CONCURRENCY"]) || 4);
const port = process.env["PORT"] ?? "8080";
const entry = new URL(".output/server/index.mjs", `file://${process.cwd()}/`).pathname;

const children = new Map<number, ReturnType<typeof Bun.spawn>>();
const restartTimes = new Map<number, number[]>();
let shuttingDown = false;

function log(message: string) {
  console.error(`[cluster] ${message}`);
}

function spawnWorker(index: number) {
  if (shuttingDown) return;
  const proc = Bun.spawn(["bun", "run", entry], {
    env: { ...process.env, WORKER_INDEX: String(index) },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_proc, exitCode) {
      children.delete(index);
      if (shuttingDown) return;
      const now = Date.now();
      const recent = (restartTimes.get(index) ?? []).filter((t) => now - t < 60_000);
      recent.push(now);
      restartTimes.set(index, recent);
      if (recent.length > 5) {
        log(`worker ${index} is flapping (${recent.length} restarts in 60s), giving up`);
        shutdown(1);
        return;
      }
      const backoffMs = Math.min(1000 * 2 ** (recent.length - 1), 15_000);
      log(`worker ${index} exited (code ${exitCode}), restarting in ${backoffMs}ms`);
      setTimeout(() => spawnWorker(index), backoffMs);
    },
  });
  children.set(index, proc);
  log(`worker ${index} started (pid ${proc.pid})`);
}

async function waitForPrimaryHealthy(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthcheck`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  if (!shuttingDown) {
    throw new Error(`worker 0 did not become healthy within ${timeoutMs}ms`);
  }
}

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down ${children.size} workers`);
  for (const proc of children.values()) proc.kill("SIGTERM");
  // Hard-exit fallback if a worker hangs on graceful shutdown.
  const forceTimer = setTimeout(() => process.exit(code), 10_000);
  void Promise.all([...children.values()].map((p) => p.exited)).then(() => {
    clearTimeout(forceTimer);
    process.exit(code);
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

spawnWorker(0);
if (concurrency > 1) {
  await waitForPrimaryHealthy();
  log(`worker 0 healthy — starting ${concurrency - 1} more workers`);
  for (let i = 1; i < concurrency; i++) spawnWorker(i);
}
