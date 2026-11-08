import { describe, expect, it } from "bun:test";
import { createStorage } from "unstorage";
import sqliteKv, { createSharedKvDb, type KvDb } from "./sqlite-kv";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function initializationProbe(db: KvDb) {
  const entered = deferred();
  const release = deferred();
  const creates = new Set<object>();
  let attempts = 0;
  let operations = 0;
  let fail = false;
  const instrumented = db.withPlugin({
    transformQuery({ node, queryId }) {
      if (node.kind === "CreateTableNode") {
        attempts++;
        if (fail) throw new Error("CREATE failed");
        creates.add(queryId);
      } else {
        operations++;
      }
      return node;
    },
    async transformResult({ result, queryId }) {
      if (creates.delete(queryId)) {
        entered.resolve();
        await release.promise;
      }
      return result;
    },
  });
  return {
    db: instrumented,
    entered: entered.promise,
    release: release.resolve,
    setFail: (value: boolean) => {
      fail = value;
    },
    attempts: () => attempts,
    operations: () => operations,
  };
}

type TestDriver = ReturnType<typeof sqliteKv>;
const operations: [string, (driver: TestDriver) => unknown][] = [
  ["hasItem", (driver) => driver.hasItem!("key", {})],
  ["getItem", (driver) => driver.getItem!("key", {})],
  ["setItem", (driver) => driver.setItem!("key", "value", {})],
  ["setItems", (driver) => driver.setItems!([{ key: "key", value: "value" }], {})],
  ["removeItem", (driver) => driver.removeItem!("key", {})],
  ["getMeta", (driver) => driver.getMeta!("key", {})],
  ["getKeys", (driver) => driver.getKeys!("", {})],
  ["clear", (driver) => driver.clear!("", {})],
];

describe("SQLite KV table readiness", () => {
  it("rejects a failed CREATE for every waiter, then retries on the next operation", async () => {
    const { db } = createSharedKvDb(":memory:");
    const probe = initializationProbe(db);
    const driver = sqliteKv({ table: "kv", db: probe.db });
    try {
      probe.setFail(true);
      const results = await Promise.allSettled(operations.map(([, run]) => run(driver)));
      expect(probe.attempts()).toBe(1);
      expect(probe.operations()).toBe(0);
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") expect(String(result.reason)).toContain("CREATE failed");
      }
      probe.setFail(false);
      probe.release();
      await driver.setItem!("key", "value", {});
      expect(await driver.getItem!("key", {})).toBe("value");
      expect(probe.attempts()).toBe(2);
    } finally {
      probe.release();
      await db.destroy();
    }
  });

  it("joins simultaneous initialization in one awaited attempt", async () => {
    const { db } = createSharedKvDb(":memory:");
    const probe = initializationProbe(db);
    const driver = sqliteKv({ table: "kv", db: probe.db });
    const pending = operations.map(([, run]) => run(driver));
    try {
      await probe.entered;
      expect(probe.attempts()).toBe(1);
      expect(probe.operations()).toBe(0);
      probe.release();
      await Promise.all(pending);
      expect(probe.attempts()).toBe(1);
      expect(probe.operations()).toBeGreaterThan(0);
    } finally {
      probe.release();
      await Promise.allSettled(pending);
      await db.destroy();
    }
  });

  it("gates startup-style storage key preloading", async () => {
    const { db } = createSharedKvDb(":memory:");
    const probe = initializationProbe(db);
    const storage = createStorage({ driver: sqliteKv({ table: "kv", db: probe.db }) });
    const pending = storage.getKeys();
    try {
      await probe.entered;
      expect(probe.operations()).toBe(0);
      probe.release();
      expect(await pending).toEqual([]);
      expect(probe.attempts()).toBe(1);
    } finally {
      probe.release();
      await pending;
      await storage.dispose();
    }
  });

  it("keeps getInstance synchronous without starting an unobserved CREATE", async () => {
    const { db } = createSharedKvDb(":memory:");
    const probe = initializationProbe(db);
    const driver = sqliteKv({ table: "kv", db: probe.db });
    try {
      expect(driver.getInstance!()).toBe(probe.db);
      await Promise.resolve();
      expect(probe.attempts()).toBe(0);
    } finally {
      await driver.dispose!();
    }
  });
});
