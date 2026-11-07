import { expect, it } from "bun:test";

it("boots a sibling with a usable page-cache mount on an independent in-memory connection", async () => {
  // A subprocess exercises real dependency initialization without sharing env or
  // module mocks with the rest of the suite, and starts no ingester or HTTP server.
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { createAppDeps } from "./src/context.ts";
      const deps = await createAppDeps();
      await deps.kv.setItem("page:boot", "cached");
      if (await deps.kv.getItem("page:boot") !== "cached") throw new Error("page cache disabled");
      console.log("page-cache-boot-ok");
      process.exit(0);
    `,
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: "test",
        WORKER_INDEX: "1",
        DB_PATH: ":memory:",
        KV_DB_PATH: ":memory:",
        PUBLIC_URL: "http://127.0.0.1:8080",
        BOOKHIVE_SERVICE_HANDLE: "",
        BOOKHIVE_APP_PASSWORD: "",
        OPEN_OBSERVE_URL: "",
      },
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
  expect(stdout).toContain("page-cache-boot-ok");
  expect(stdout).not.toContain("page cache unavailable");
});
