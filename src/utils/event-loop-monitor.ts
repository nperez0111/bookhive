import { getLogger } from "../logger/index.ts";

const INTERVAL_MS = 500;
const WARN_THRESHOLD_MS = 200;

const logger = getLogger({ name: "event-loop-monitor" });

/**
 * Detects event-loop blocking by scheduling a recurring timer and measuring
 * how late it fires. If a setTimeout(fn, 500) fires after 5500ms, the loop
 * was blocked for ~5000ms.
 *
 * Logs a warning whenever the lag exceeds WARN_THRESHOLD_MS.
 */
export function startEventLoopMonitor(): void {
  let lastTick = performance.now();

  function tick() {
    const now = performance.now();
    const elapsed = now - lastTick;
    const lag = elapsed - INTERVAL_MS;

    if (lag > WARN_THRESHOLD_MS) {
      logger.warn(
        {
          msg: "event_loop_lag",
          lag_ms: Math.round(lag),
          elapsed_ms: Math.round(elapsed),
          expected_ms: INTERVAL_MS,
        },
        `Event loop blocked for ${Math.round(lag)}ms`,
      );
    }

    lastTick = now;
    setTimeout(tick, INTERVAL_MS);
  }

  setTimeout(tick, INTERVAL_MS);
}
