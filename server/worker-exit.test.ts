import { describe, it, expect } from "bun:test";
import { classifyWorkerExit, readProcessMemoryKb, signalName } from "./worker-exit.ts";

describe("signalName", () => {
  // The bug: Bun passes the signal *name*, its types claim a number, and the
  // number-keyed lookup fell through to `SIG${code}` — producing "SIGSIGKILL"
  // in production for every one of 148 OOM kills.
  it("passes through a name Bun already prefixed", () => {
    expect(signalName("SIGKILL")).toBe("SIGKILL");
    expect(signalName("SIGTERM")).toBe("SIGTERM");
  });

  it("still maps a numeric code, in case Bun's types become honest", () => {
    expect(signalName(9)).toBe("SIGKILL");
    expect(signalName(15)).toBe("SIGTERM");
  });

  it("is null for a clean exit", () => {
    expect(signalName(null)).toBeNull();
    expect(signalName(undefined)).toBeNull();
  });

  it("prefixes a bare name", () => {
    expect(signalName("KILL")).toBe("SIGKILL");
  });
});

describe("classifyWorkerExit", () => {
  it("flags a cgroup OOM kill", () => {
    const event = classifyWorkerExit({
      index: 1,
      pid: 4242,
      exitCode: null,
      signalCode: "SIGKILL",
      uptimeMs: 775_653,
    });

    expect(event.signal).toBe("SIGKILL");
    expect(event.likely_oom).toBe(true);
    expect(event.msg).toBe("worker_exit");
    expect(event.level).toBe(50);
    expect(event.worker).toBe(1);
    expect(event.pid).toBe(4242);
    expect(event.uptime_ms).toBe(775_653);
  });

  it("does not flag a graceful exit as an OOM", () => {
    const event = classifyWorkerExit({
      index: 0,
      exitCode: 0,
      signalCode: null,
      uptimeMs: 1_000,
    });
    expect(event.signal).toBeNull();
    expect(event.likely_oom).toBe(false);
  });

  it("does not flag SIGTERM as an OOM", () => {
    const event = classifyWorkerExit({
      index: 0,
      exitCode: null,
      signalCode: "SIGTERM",
      uptimeMs: 1_000,
    });
    expect(event.likely_oom).toBe(false);
  });

  it("does not flag a SIGKILL that carried an exit code", () => {
    // Something other than the kernel's OOM killer produced this.
    const event = classifyWorkerExit({
      index: 0,
      exitCode: 137,
      signalCode: "SIGKILL",
      uptimeMs: 1_000,
    });
    expect(event.likely_oom).toBe(false);
  });

  it("carries the last memory sample so a kill is attributable", () => {
    const event = classifyWorkerExit({
      index: 2,
      exitCode: null,
      signalCode: "SIGKILL",
      uptimeMs: 700_000,
      memory: { rss_kb: 2_580_000, anon_kb: 1_779_772 },
    });
    expect(event.anon_kb).toBe(1_779_772);
    expect(event.rss_kb).toBe(2_580_000);
  });

  it("omits memory fields entirely when there is no sample", () => {
    const event = classifyWorkerExit({
      index: 0,
      exitCode: null,
      signalCode: "SIGKILL",
      uptimeMs: 1,
      memory: null,
    });
    expect("anon_kb" in event).toBe(false);
    expect("rss_kb" in event).toBe(false);
  });

  it("serializes to a single JSON log line", () => {
    const line = JSON.parse(
      JSON.stringify(
        classifyWorkerExit({
          index: 1,
          exitCode: null,
          signalCode: "SIGKILL",
          uptimeMs: 5,
        }),
      ),
    );
    expect(line.msg).toBe("worker_exit");
    expect(line.signal).toBe("SIGKILL");
    expect(line.likely_oom).toBe(true);
  });
});

describe("readProcessMemoryKb", () => {
  const SMAPS = [
    "Rss:             1624780 kB",
    "Pss:             1019518 kB",
    "Shared_Clean:    1028192 kB",
    "Private_Dirty:    554892 kB",
    "Anonymous:        554892 kB",
  ].join("\n");

  it("parses Rss and Anonymous out of smaps_rollup", () => {
    expect(readProcessMemoryKb(1, () => SMAPS)).toEqual({
      rss_kb: 1_624_780,
      anon_kb: 554_892,
    });
  });

  it("returns null off Linux, where procfs does not exist", () => {
    expect(
      readProcessMemoryKb(1, () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });

  it("returns null for output with neither field", () => {
    expect(readProcessMemoryKb(1, () => "Pss: 12 kB")).toBeNull();
  });
});
