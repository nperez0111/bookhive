import { expect, it } from "bun:test";

for (const [setting, expected] of [
  [undefined, 2],
  ["MEMORY", 2],
  ["FILE", 1],
] as const) {
  it(`main DB temp_store is ${expected} with DB_TEMP_STORE=${setting ?? "unset"}`, async () => {
    // Env freezes at import time. A fresh process with the test preload checks
    // the real factory without process-wide module mocks or parent env mutation.
    const childEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
    delete childEnv["DB_TEMP_STORE"];
    if (setting !== undefined) childEnv["DB_TEMP_STORE"] = setting;
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        "./src/test/env-setup.ts",
        "--eval",
        `
          import { createDb } from "./src/db.ts";
          import { createSharedKvDb } from "./src/sqlite-kv.ts";
          import { Database } from "bun:sqlite";
          const { sqlite } = createDb(":memory:");
          const { sqlite: kv } = createSharedKvDb(":memory:");
          const raw = new Database(":memory:");
          const main = sqlite.query("PRAGMA temp_store").get();
          const kvMode = kv.query("PRAGMA temp_store").get();
          const defaultMode = raw.query("PRAGMA temp_store").get();
          console.log(JSON.stringify({
            ...main,
            kvMatchesDefault: kvMode.temp_store === defaultMode.temp_store,
          }));
          sqlite.close();
          kv.close();
          raw.close();
        `,
      ],
      {
        cwd: new URL("..", import.meta.url).pathname,
        env: childEnv,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ temp_store: expected, kvMatchesDefault: true });
  });
}
