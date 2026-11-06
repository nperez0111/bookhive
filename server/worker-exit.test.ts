import { describe, it, expect } from "bun:test";
import {
  classifyWorkerExit,
  readCgroupMemory,
  readHostMemory,
  readProcessMemoryKb,
  signalName,
} from "./worker-exit.ts";

describe("signalName", () => {
  // The bug: Bun passes the signal *name*, its types claim a number, and the number-keyed lookup fell through to `SIG${code}`, producing "SIGSIGKILL".
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

describe("readHostMemory", () => {
  it("records host availability, swap and pressure without unrelated procfs fields", () => {
    expect(
      readHostMemory((path) =>
        path === "/proc/meminfo"
          ? "MemTotal: 8000 kB\nMemAvailable: 1000 kB\nSwapTotal: 4000 kB\nSwapFree: 500 kB\nCached: 900 kB\n"
          : "some avg10=1.25 avg60=2.00 avg300=3.50 total=1234\nfull avg10=0.50 avg60=1.00 avg300=2.50 total=900\n",
      ),
    ).toEqual({
      MemTotal_kb: 8000,
      MemAvailable_kb: 1000,
      SwapTotal_kb: 4000,
      SwapFree_kb: 500,
      "pressure.some.avg10": 1.25,
      "pressure.some.avg60": 2,
      "pressure.some.avg300": 3.5,
      "pressure.some.total": 1234,
      "pressure.full.avg10": 0.5,
      "pressure.full.avg60": 1,
      "pressure.full.avg300": 2.5,
      "pressure.full.total": 900,
    });
  });
  it("tolerates unavailable procfs", () => {
    expect(
      readHostMemory(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});

describe("readCgroupMemory", () => {
  it("records OOM counters and anonymous versus file memory, tolerating unlimited/missing fields", () => {
    const files: Record<string, string> = {
      "memory.current": "5000\n",
      "memory.max": "max\n",
      "memory.peak": "6000\n",
      "memory.events": "oom 3\noom_kill 2\nmax 4820\n",
      "memory.stat": "anon 4000\nfile 1000\nkernel 100\npgfault 99999\n",
    };
    expect(
      readCgroupMemory((path) => {
        const value = files[path.split("/").at(-1)!];
        if (value === undefined) throw new Error("ENOENT");
        return value;
      }),
    ).toEqual({
      "memory.current": 5000,
      "memory.peak": 6000,
      "memory.events.oom": 3,
      "memory.events.oom_kill": 2,
      "memory.events.max": 4820,
      "memory.stat.anon": 4000,
      "memory.stat.file": 1000,
      "memory.stat.kernel": 100,
    });
  });
  it("does not invent zero-valued samples when procfs is unavailable", () => {
    expect(
      readCgroupMemory(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});
