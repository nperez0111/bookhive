import { expect, it } from "bun:test";
import type { SessionClient } from "../auth/client";

// Import suites permanently mock this module. Run the real pagination checks in
// a child process so their mocks cannot accidentally turn these into no-ops.
if (process.env["BOOKHIVE_IMPORT_RECORDS_CHECK"] === "1") {
  const { getImportBookRecords } = await import("./importBookRecords");
  const calls: Array<Record<string, unknown>> = [];
  const book = {
    $type: "buzz.bookhive.book",
    hiveId: "bk_test",
    title: "A book",
    authors: "A writer",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const pages = [
    {
      records: [
        { uri: "at://did:plc:test/buzz.bookhive.book/original-a", value: book },
        { uri: "at://did:plc:test/buzz.bookhive.book/invalid", value: {} },
      ],
      cursor: "one",
    },
    { records: [], cursor: "two" },
    {
      records: [
        {
          uri: "at://did:plc:test/buzz.bookhive.book/original-z",
          value: { ...book, title: "Duplicate HiveId, different rkey" },
        },
      ],
    },
  ];
  const agent = {
    did: "did:plc:test",
    get: async (_method: string, { params }: { params: Record<string, unknown> }) => {
      calls.push(params);
      return { ok: true, data: pages[calls.length - 1] };
    },
  } as unknown as SessionClient;
  const result = await getImportBookRecords({ agent });
  expect([...result.books.keys()]).toEqual(["original-a", "original-z"]);
  expect([...result.books.values()].map((b) => b.title)).toEqual([
    "A book",
    "Duplicate HiveId, different rkey",
  ]);
  expect(calls.map((p) => p["cursor"])).toEqual([undefined, "one", "two"]);
  expect(
    calls.every(
      (p) =>
        p["collection"] === "buzz.bookhive.book" && p["limit"] === 100 && p["reverse"] === false,
    ),
  ).toBe(true);

  const failed = { did: agent.did, get: async () => ({ ok: false }) } as unknown as SessionClient;
  await getImportBookRecords({ agent: failed }).then(
    () => {
      throw new Error("Expected failure");
    },
    (error: Error) => {
      expect(error.message).toContain("Could not read");
    },
  );
  const repeated = {
    did: agent.did,
    get: async () => ({ ok: true, data: { records: [], cursor: "same" } }),
  } as unknown as SessionClient;
  await getImportBookRecords({ agent: repeated }).then(
    () => {
      throw new Error("Expected failure");
    },
    (error: Error) => {
      expect(error.message).toContain("did not advance");
    },
  );
} else {
  it("paginates only book records, preserves original rkeys/order, and rejects partial traversals", async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      env: { ...process.env, BOOKHIVE_IMPORT_RECORDS_CHECK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
  });
}
