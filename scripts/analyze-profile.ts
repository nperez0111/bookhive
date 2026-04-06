#!/usr/bin/env bun
/**
 * CPU Profile Analyzer
 * Parses Chrome DevTools .cpuprofile JSON and outputs actionable insights.
 *
 * Usage: bun run scripts/analyze-profile.ts <path-to-cpuprofile>
 */

interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  children?: number[];
  hitCount?: number;
}

interface CPUProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

interface FunctionStats {
  name: string;
  url: string;
  line: number;
  selfTime: number; // microseconds
  totalTime: number; // microseconds
  selfHits: number;
  totalHits: number;
}

type Category = "app" | "deps" | "runtime" | "native" | "gc" | "idle";

// ── Parse ────────────────────────────────────────────────────────────

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: bun run scripts/analyze-profile.ts <path-to-cpuprofile>");
  process.exit(1);
}

const raw = await Bun.file(filePath).text();
const profile: CPUProfile = JSON.parse(raw);

const totalDuration = profile.endTime - profile.startTime; // microseconds
const sampleCount = profile.samples.length;

console.log("═══════════════════════════════════════════════════════════");
console.log("  CPU Profile Analysis");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Duration:    ${(totalDuration / 1_000_000).toFixed(2)}s`);
console.log(`  Samples:     ${sampleCount.toLocaleString()}`);
console.log(`  Nodes:       ${profile.nodes.length.toLocaleString()}`);
console.log(
  `  Sample rate: ~${sampleCount > 1 ? Math.round(1_000_000 / (totalDuration / sampleCount)) : 0} Hz`,
);
console.log();

// ── Build lookup maps ────────────────────────────────────────────────

const nodeMap = new Map<number, ProfileNode>();
for (const node of profile.nodes) {
  nodeMap.set(node.id, node);
}

// parentMap: child id → parent id
const parentMap = new Map<number, number>();
for (const node of profile.nodes) {
  if (node.children) {
    for (const childId of node.children) {
      parentMap.set(childId, node.id);
    }
  }
}

// ── Compute self time from samples + timeDeltas ─────────────────────

const selfTimeMap = new Map<number, number>(); // node id → microseconds
const selfHitMap = new Map<number, number>();

for (let i = 0; i < profile.samples.length; i++) {
  const nodeId = profile.samples[i];
  const delta = profile.timeDeltas[i] ?? 0;
  selfTimeMap.set(nodeId, (selfTimeMap.get(nodeId) ?? 0) + delta);
  selfHitMap.set(nodeId, (selfHitMap.get(nodeId) ?? 0) + 1);
}

// ── Compute total time (self + all descendant self time) ────────────

// For each sample, attribute time to the entire call stack (leaf → root)
const totalTimeMap = new Map<number, number>();
const totalHitMap = new Map<number, number>();

for (let i = 0; i < profile.samples.length; i++) {
  const delta = profile.timeDeltas[i] ?? 0;
  let nodeId: number | undefined = profile.samples[i];
  const visited = new Set<number>();
  while (nodeId !== undefined && !visited.has(nodeId)) {
    visited.add(nodeId);
    totalTimeMap.set(nodeId, (totalTimeMap.get(nodeId) ?? 0) + delta);
    totalHitMap.set(nodeId, (totalHitMap.get(nodeId) ?? 0) + 1);
    nodeId = parentMap.get(nodeId);
  }
}

// ── Aggregate by function identity (name + url + line) ──────────────

const funcKey = (n: ProfileNode) =>
  `${n.callFrame.functionName || "(anonymous)"}|${n.callFrame.url}|${n.callFrame.lineNumber}`;

const statsMap = new Map<string, FunctionStats>();

for (const node of profile.nodes) {
  const key = funcKey(node);
  const existing = statsMap.get(key);
  const self = selfTimeMap.get(node.id) ?? 0;
  const total = totalTimeMap.get(node.id) ?? 0;
  const selfHits = selfHitMap.get(node.id) ?? 0;
  const totalHits = totalHitMap.get(node.id) ?? 0;

  if (existing) {
    existing.selfTime += self;
    existing.totalTime += total;
    existing.selfHits += selfHits;
    existing.totalHits += totalHits;
  } else {
    statsMap.set(key, {
      name: node.callFrame.functionName || "(anonymous)",
      url: node.callFrame.url,
      line: node.callFrame.lineNumber,
      selfTime: self,
      totalTime: total,
      selfHits: selfHits,
      totalHits: totalHits,
    });
  }
}

const allStats = [...statsMap.values()];

// ── Helpers ──────────────────────────────────────────────────────────

function fmtTime(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`;
  if (us >= 1_000) return `${(us / 1_000).toFixed(1)}ms`;
  return `${us.toFixed(0)}µs`;
}

function fmtPct(us: number): string {
  return `${((us / totalDuration) * 100).toFixed(1)}%`;
}

function shortUrl(url: string): string {
  if (!url) return "(native)";
  // Strip common prefixes to keep output readable
  return url
    .replace(/^file:\/\//, "")
    .replace(/.*\/node_modules\//, "node_modules/")
    .replace(/.*\/src\//, "src/");
}

function categorize(url: string, name: string): Category {
  if (!url && !name) return "idle";
  if (name === "(garbage collector)" || name === "(GC)") return "gc";
  if (!url || name === "(program)" || name === "(idle)")
    return name === "(idle)" ? "idle" : "native";
  if (url.includes("/node_modules/")) return "deps";
  if (url.includes("/src/") || url.includes("/scripts/")) return "app";
  // Bun/Node internals
  if (url.startsWith("node:") || url.includes("bun:")) return "runtime";
  return "native";
}

// ── Section 1: Top Functions by Self Time ────────────────────────────

console.log("── Top 20 Functions by Self Time (where CPU is actually spent) ──");
console.log();

const bySelf = allStats
  .filter((s) => s.selfTime > 0)
  .sort((a, b) => b.selfTime - a.selfTime)
  .slice(0, 20);

console.log(
  padR("Self Time", 12) + padR("Self %", 9) + padR("Hits", 8) + padR("Function", 40) + "Location",
);
console.log("─".repeat(100));
for (const s of bySelf) {
  console.log(
    padR(fmtTime(s.selfTime), 12) +
      padR(fmtPct(s.selfTime), 9) +
      padR(s.selfHits.toLocaleString(), 8) +
      padR(truncate(s.name, 38), 40) +
      `${shortUrl(s.url)}:${s.line}`,
  );
}
console.log();

// ── Section 2: Top Functions by Total Time ───────────────────────────

console.log("── Top 20 Functions by Total Time (including callees) ──");
console.log();

const byTotal = allStats
  .filter((s) => s.totalTime > 0 && s.name !== "(root)" && s.name !== "(idle)")
  .sort((a, b) => b.totalTime - a.totalTime)
  .slice(0, 20);

console.log(
  padR("Total Time", 12) +
    padR("Total %", 9) +
    padR("Self %", 9) +
    padR("Function", 40) +
    "Location",
);
console.log("─".repeat(100));
for (const s of byTotal) {
  console.log(
    padR(fmtTime(s.totalTime), 12) +
      padR(fmtPct(s.totalTime), 9) +
      padR(fmtPct(s.selfTime), 9) +
      padR(truncate(s.name, 38), 40) +
      `${shortUrl(s.url)}:${s.line}`,
  );
}
console.log();

// ── Section 3: Category Breakdown ────────────────────────────────────

console.log("── Time Breakdown by Category ──");
console.log();

const categoryTime = new Map<Category, number>();
for (const s of allStats) {
  const cat = categorize(s.url, s.name);
  categoryTime.set(cat, (categoryTime.get(cat) ?? 0) + s.selfTime);
}

const categories: Category[] = ["app", "deps", "runtime", "native", "gc", "idle"];
const catLabels: Record<Category, string> = {
  app: "App code (src/)",
  deps: "Dependencies (node_modules/)",
  runtime: "Bun/Node runtime",
  native: "Native/C++ (program)",
  gc: "Garbage Collection",
  idle: "Idle",
};

for (const cat of categories) {
  const t = categoryTime.get(cat) ?? 0;
  if (t === 0) continue;
  const pct = (t / totalDuration) * 100;
  const bar = "█".repeat(Math.round(pct / 2)) + "░".repeat(Math.max(0, 50 - Math.round(pct / 2)));
  console.log(
    `  ${padR(catLabels[cat], 30)} ${padR(fmtTime(t), 10)} ${padR(pct.toFixed(1) + "%", 7)} ${bar}`,
  );
}
console.log();

// ── Section 4: Hot Call Stacks ───────────────────────────────────────

console.log("── Top 10 Hottest Call Stacks ──");
console.log();

// Group samples by their full stack trace
const stackMap = new Map<string, { time: number; hits: number; stack: string[] }>();

for (let i = 0; i < profile.samples.length; i++) {
  const delta = profile.timeDeltas[i] ?? 0;
  const stack: string[] = [];
  let nodeId: number | undefined = profile.samples[i];
  const visited = new Set<number>();
  while (nodeId !== undefined && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (node && node.callFrame.functionName && node.callFrame.functionName !== "(root)") {
      stack.push(
        `${node.callFrame.functionName} (${shortUrl(node.callFrame.url)}:${node.callFrame.lineNumber})`,
      );
    }
    nodeId = parentMap.get(nodeId);
  }
  stack.reverse();

  // Use top 5 frames as the key to group similar stacks
  const keyFrames = stack.slice(-5);
  const key = keyFrames.join(" → ");
  const existing = stackMap.get(key);
  if (existing) {
    existing.time += delta;
    existing.hits += 1;
  } else {
    stackMap.set(key, { time: delta, hits: 1, stack });
  }
}

const hotStacks = [...stackMap.values()]
  .filter((s) => s.stack.length > 0)
  .sort((a, b) => b.time - a.time)
  .slice(0, 10);

for (let i = 0; i < hotStacks.length; i++) {
  const hs = hotStacks[i];
  console.log(`  #${i + 1}  ${fmtTime(hs.time)} (${fmtPct(hs.time)}) — ${hs.hits} samples`);
  // Show the last 6 frames (most specific)
  const frames = hs.stack.slice(-6);
  if (hs.stack.length > 6) console.log(`       ... (${hs.stack.length - 6} more frames)`);
  for (const frame of frames) {
    console.log(`       → ${frame}`);
  }
  console.log();
}

// ── Section 5: Suspicious Patterns ───────────────────────────────────

console.log("── Suspicious Patterns ──");
console.log();

const suspiciousPatterns = [
  {
    label: "JSON.parse / JSON.stringify",
    test: (name: string) => /JSON\.(parse|stringify)/i.test(name),
  },
  {
    label: "RegExp / match / replace",
    test: (name: string) => /regexp|\.match|\.replace|\.test|\.exec/i.test(name),
  },
  {
    label: "Crypto / hashing",
    test: (name: string) => /crypto|hash|sha|md5|hmac|pbkdf/i.test(name),
  },
  {
    label: "Compression (gzip/deflate/zlib)",
    test: (name: string) => /gzip|deflate|zlib|compress|brotli/i.test(name),
  },
  {
    label: "Template / JSX rendering",
    test: (name: string) => /render|jsx|template|html|serialize/i.test(name),
  },
  {
    label: "Database / SQL",
    test: (name: string) => /query|sql|sqlite|prepare|execute|kysely/i.test(name),
  },
  { label: "Garbage Collection", test: (name: string) => /garbage collector|GC/i.test(name) },
];

let foundSuspicious = false;
for (const pattern of suspiciousPatterns) {
  const matches = allStats.filter((s) => pattern.test(s.name) && s.selfTime > 0);
  if (matches.length === 0) continue;
  const totalSelf = matches.reduce((sum, m) => sum + m.selfTime, 0);
  if (totalSelf / totalDuration < 0.005) continue; // skip if < 0.5%

  foundSuspicious = true;
  console.log(`  ⚠ ${pattern.label}: ${fmtTime(totalSelf)} (${fmtPct(totalSelf)} of profile)`);
  const top3 = matches.sort((a, b) => b.selfTime - a.selfTime).slice(0, 3);
  for (const m of top3) {
    console.log(`      ${padR(fmtTime(m.selfTime), 10)} ${m.name} — ${shortUrl(m.url)}:${m.line}`);
  }
  console.log();
}

if (!foundSuspicious) {
  console.log("  No obvious suspicious patterns found above 0.5% threshold.");
  console.log();
}

// ── Section 6: Dependency Breakdown ──────────────────────────────────

const depTime = new Map<string, number>();
for (const s of allStats) {
  if (!s.url.includes("/node_modules/")) continue;
  // Extract package name (handles scoped packages)
  const match = s.url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (!match) continue;
  depTime.set(match[1], (depTime.get(match[1]) ?? 0) + s.selfTime);
}

const topDeps = [...depTime.entries()]
  .sort((a, b) => b[1] - a[1])
  .filter(([, t]) => t / totalDuration > 0.005)
  .slice(0, 10);

if (topDeps.length > 0) {
  console.log("── Top Dependencies by CPU Self Time ──");
  console.log();
  for (const [pkg, t] of topDeps) {
    console.log(`  ${padR(pkg, 35)} ${padR(fmtTime(t), 10)} ${fmtPct(t)}`);
  }
  console.log();
}

// ── Done ─────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════");
console.log("  Analysis complete. Open the .cpuprofile in Chrome");
console.log("  DevTools (Performance tab → Load profile) for flame chart.");
console.log("═══════════════════════════════════════════════════════════");

// ── Utility ──────────────────────────────────────────────────────────

function padR(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
