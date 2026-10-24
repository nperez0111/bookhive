import {
  accountCacheKey,
  epochStorage,
  createAuthSessionScope,
  isTerminalRefreshStatus,
  parseAuthState,
} from "../authSession";

const accountA = { did: "did:plc:a", handle: "a.test", sid: "sid-a" };
const accountB = { did: "did:plc:b", handle: "b.test", sid: "sid-b" };

it("partitions persisted data by account and origin, ignoring late A flushes after B signs in", async () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => entries.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: async (key: string) => {
      entries.delete(key);
    },
  };
  const session = createAuthSessionScope();
  session.replace(accountA);
  const epochA = session.epoch;
  const cacheA = epochStorage(storage, () => session.epoch === epochA);
  const keyA = accountCacheKey("https://bookhive.buzz", accountA.did);
  await cacheA.setItem(keyA, "A private data");
  session.replace(null);
  session.replace(accountB);
  const keyB = accountCacheKey("https://bookhive.buzz", accountB.did);
  expect(await storage.getItem(keyB)).toBeNull();
  expect(await storage.getItem(accountCacheKey("https://dev.test", accountA.did))).toBeNull();
  await cacheA.setItem(keyA, "late stale response");
  expect(await storage.getItem(keyA)).toBe("A private data");
});

it("logout immediately removes credentials and invalidates A work before B signs in", () => {
  const session = createAuthSessionScope();
  session.replace(accountA);
  const requestA = session.capture();
  session.replace(null);
  expect(session.state).toBeNull();
  expect(requestA.signal.aborted).toBe(true);
  session.replace(accountB);
  expect(requestA.state?.sid).toBe("sid-a");
  expect(() => requestA.assertCurrent()).toThrow("session changed");
  expect(session.capture().state?.sid).toBe("sid-b");
});

it("returning to the same account cannot revive old work", () => {
  const session = createAuthSessionScope();
  session.replace(accountA);
  const old = session.capture();
  session.replace(null);
  session.replace(accountA);
  expect(() => old.assertCurrent()).toThrow();
});

it("offline, timeouts and server failures preserve credentials; only auth rejection terminates", () => {
  for (const status of [undefined, 400, 408, 429, 500, 503]) {
    expect(isTerminalRefreshStatus(status)).toBe(false);
  }
  expect(isTerminalRefreshStatus(401)).toBe(true);
  expect(isTerminalRefreshStatus(403)).toBe(true);
});

it("rejects malformed saved credentials and callbacks", () => {
  for (const value of [null, {}, { ...accountA, sid: "" }, { ...accountA, did: 123 }]) {
    expect(parseAuthState(value)).toBeNull();
  }
  expect(parseAuthState(accountA)).toEqual(accountA);
});
