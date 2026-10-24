import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { getIronSession, sealData } from "iron-session";
import { P256PrivateKeyExportable } from "@atcute/crypto";
import { createServiceJwt, ServiceJwtVerifier } from "@atcute/xrpc-server/auth";
import type { Nsid } from "@atcute/lexicons";
import type { AppEnv, Session } from "../context";
import type { SessionClient } from "../auth/client";
import { getCachedSessionClient, getSessionConfig, setCachedSessionClient } from "../auth/session";
import { createTestDb, testContext } from "../test/db";
import { createXrpcRouter } from "./router";

const DID = "did:plc:reader" as const;
const AUDIENCE = "did:plc:enu2j5xjlqsjaylv3du4myh4" as const;
let database: Awaited<ReturnType<typeof createTestDb>>;
let keypair: P256PrivateKeyExportable;
let verifier: ServiceJwtVerifier;
beforeAll(async () => {
  database = await createTestDb();
  keypair = await P256PrivateKeyExportable.createKeypair();
  verifier = new ServiceJwtVerifier({
    acceptAudiences: [AUDIENCE],
    resolver: {
      resolve: async () => ({
        id: DID,
        verificationMethod: [
          {
            id: `${DID}#atproto`,
            type: "Multikey",
            controller: DID,
            publicKeyMultibase: await keypair.exportPublicKey("multikey"),
          },
        ],
      }),
    } as never,
  });
});
afterAll(async () => {
  await database.close();
});

function setup(opts: { signedIn?: boolean; liveSession?: boolean; profile?: boolean } = {}) {
  const agent = { did: DID } as SessionClient;
  const refetchBooks = mock(async () => {});
  const deleteAccountData = mock(async () => {});
  const revoke = mock(async () => {});
  const restore = mock(async () => (opts.liveSession === false ? null : agent));
  const wideEvent: Record<string, unknown> = {};
  let requestError: unknown;
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    const ctx = testContext({
      db: database.db,
      serviceJwtVerifier: verifier,
      // Real cookie decryption plus the real XRPC auth resolver; only the network restore is stubbed.
      getSessionAgent: async () => {
        const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
        return session.did === DID ? restore() : null;
      },
      getProfile: async () => (opts.profile === false ? null : { did: DID, handle: "reader.test" }),
      addWideEventContext: (fields) => Object.assign(wideEvent, fields),
    });
    ctx.oauthClient = { revoke } as unknown as typeof ctx.oauthClient;
    c.set("ctx", ctx);
    await next();
    requestError = c.get("requestError");
  });
  createXrpcRouter(app, {
    searchBooks: async () => [],
    ensureBookIdentifiersCurrent: async () => {},
    getProfile: async () => null,
    refetchBooks,
    deleteAccountData,
  });
  const post = async (method: string, body: unknown, headers: Record<string, string> = {}) => {
    const cookie =
      opts.signedIn === false
        ? ""
        : `sid=${await sealData({ did: DID }, { password: getSessionConfig().password })}`;
    return app.request(`/xrpc/buzz.bookhive.${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(body),
    });
  };
  return {
    post,
    refetchBooks,
    deleteAccountData,
    revoke,
    restore,
    agent,
    wideEvent,
    requestError: () => requestError,
  };
}

test("account procedures require a live OAuth session, not just a cookie identity", async () => {
  for (const opts of [{ signedIn: false }, { liveSession: false }]) {
    const { post, refetchBooks, deleteAccountData } = setup(opts);
    for (const [method, body] of [
      ["resyncAccount", {}],
      ["deleteAccount", { confirmHandle: "reader.test" }],
    ] as const) {
      const response = await post(method, body);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "AuthenticationRequired" });
    }
    expect(refetchBooks).not.toHaveBeenCalled();
    expect(deleteAccountData).not.toHaveBeenCalled();
  }
});

test("valid service JWTs cannot resync or delete, even when a live cookie is also present", async () => {
  for (const signedIn of [false, true]) {
    const { post, refetchBooks, deleteAccountData, restore } = setup({ signedIn });
    for (const [method, body] of [
      ["resyncAccount", {}],
      ["deleteAccount", { confirmHandle: "reader.test" }],
    ] as const) {
      const token = await createServiceJwt({
        keypair,
        issuer: DID,
        audience: AUDIENCE,
        lxm: `buzz.bookhive.${method}` as Nsid,
      });
      const response = await post(method, body, { authorization: `Bearer ${token}` });
      expect(response.status).toBe(401);
    }
    expect(restore).not.toHaveBeenCalled();
    expect(refetchBooks).not.toHaveBeenCalled();
    expect(deleteAccountData).not.toHaveBeenCalled();
  }
});

test("resync validates strict JSON and awaits the shared implementation", async () => {
  const { post, refetchBooks, agent } = setup();
  for (const body of [{ userDid: "someone-else" }, [], null]) {
    expect((await post("resyncAccount", body)).status).toBe(400);
  }
  expect(refetchBooks).not.toHaveBeenCalled();
  let complete!: () => void;
  refetchBooks.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  let responded = false;
  const pending = post("resyncAccount", {}).then((res) => {
    responded = true;
    return res;
  });
  while (!complete) await Bun.sleep(1);
  expect(responded).toBe(false);
  complete();
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(refetchBooks).toHaveBeenCalledTimes(1);
  expect(refetchBooks).toHaveBeenCalledWith(expect.objectContaining({ agent }));
});

test("deletion requires the exact current handle and rejects extra fields", async () => {
  const { post, deleteAccountData } = setup();
  for (const body of [
    {},
    { confirmHandle: 7 },
    { confirmHandle: "" },
    { confirmHandle: "x".repeat(254) },
    { confirmHandle: "Reader.test" },
    { confirmHandle: "reader.test " },
    { confirmHandle: DID },
    { confirmHandle: "reader.test", userDid: "someone-else" },
  ]) {
    expect((await post("deleteAccount", body)).status).toBe(400);
  }
  expect(deleteAccountData).not.toHaveBeenCalled();
});

test("resync failures return an XRPC error, retain the cause for logging, and are not retried", async () => {
  const { post, refetchBooks, requestError } = setup();
  const error = new Error("PDS unavailable");
  refetchBooks.mockImplementation(async () => {
    throw error;
  });
  const response = await post("resyncAccount", {});
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ResyncFailed",
    message: "Could not re-sync your books. Please try again.",
  });
  expect(refetchBooks).toHaveBeenCalledTimes(1);
  expect(requestError()).toBe(error);
});

test("successful deletion delegates, revokes, evicts the cached client and expires the cookie", async () => {
  const { post, deleteAccountData, revoke, agent, wideEvent } = setup();
  setCachedSessionClient(DID, agent, undefined);
  const response = await post("deleteAccount", { confirmHandle: "reader.test" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(deleteAccountData).toHaveBeenCalledWith({ agent, db: database.db });
  expect(revoke).toHaveBeenCalledWith(DID);
  expect(getCachedSessionClient(DID)).toBeNull();
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(wideEvent["account_delete"]).toBe("completed");
});

test("deletion uses the DID fallback only when the profile is missing", async () => {
  const { post } = setup({ profile: false });
  const response = await post("deleteAccount", { confirmHandle: DID });
  expect(response.status).toBe(200);
});

test("deletion waits for cleanup before revoking or expiring the session", async () => {
  const { post, deleteAccountData, revoke, agent } = setup();
  setCachedSessionClient(DID, agent, undefined);
  let complete!: () => void;
  deleteAccountData.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  let responded = false;
  const pending = post("deleteAccount", { confirmHandle: "reader.test" }).then((response) => {
    responded = true;
    return response;
  });
  while (!complete) await Bun.sleep(1);
  expect(responded).toBe(false);
  expect(revoke).not.toHaveBeenCalled();
  expect(getCachedSessionClient(DID)?.client).toBe(agent);
  complete();
  const response = await pending;
  expect(response.status).toBe(200);
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("revocation failure does not misreport completed deletion or prevent local sign-out", async () => {
  const { post, revoke, wideEvent } = setup();
  revoke.mockImplementation(async () => {
    throw new Error("PDS unavailable");
  });
  const response = await post("deleteAccount", { confirmHandle: "reader.test" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(wideEvent["account_revoke"]).toBe("failed");
});

test("failed/partial deletion never reports success or revokes, evicts or expires the session", async () => {
  const { post, deleteAccountData, revoke, agent, wideEvent, requestError } = setup();
  const error = new Error("Filesystem failure after PDS cleanup");
  setCachedSessionClient(DID, agent, undefined);
  deleteAccountData.mockImplementation(async () => {
    throw error;
  });
  const response = await post("deleteAccount", { confirmHandle: "reader.test" });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "DeleteFailed",
    message: "Could not delete your data. Please try again.",
  });
  expect(deleteAccountData).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  expect(getCachedSessionClient(DID)?.client).toBe(agent);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(wideEvent["account_delete"]).toBe("failed");
  expect(requestError()).toBe(error);
});

test("overlapping deletions isolate request errors, logging and session-cookie cleanup", async () => {
  const successDid = "did:plc:success";
  const failureDid = "did:plc:failure";
  const failure = new Error("Second viewer cleanup failed");
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const entered = { [successDid]: gate(), [failureDid]: gate() };
  const finish = { [successDid]: gate(), [failureDid]: gate() };
  const errors = new Map<string, unknown>();
  const events = new Map<string, Record<string, unknown>>();
  const revoked: string[] = [];
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
    const did = session.did as typeof successDid | typeof failureDid;
    const fields: Record<string, unknown> = {};
    events.set(did, fields);
    const ctx = testContext({
      db: database.db,
      getSessionAgent: async () => ({ did }) as SessionClient,
      getProfile: async () => ({ did, handle: `${did.split(":").at(-1)}.test` }),
      addWideEventContext: (values) => Object.assign(fields, values),
    });
    ctx.oauthClient = {
      revoke: async (viewer: string) => {
        revoked.push(viewer);
      },
    } as unknown as typeof ctx.oauthClient;
    c.set("ctx", ctx);
    await next();
    errors.set(did, c.get("requestError"));
  });
  createXrpcRouter(app, {
    searchBooks: async () => [],
    ensureBookIdentifiersCurrent: async () => {},
    getProfile: async () => null,
    deleteAccountData: async ({ agent }) => {
      const did = agent.did as keyof typeof entered;
      entered[did].resolve();
      await finish[did].promise;
      if (did === failureDid) throw failure;
    },
  });
  async function remove(did: string, handle: string) {
    return app.request("/xrpc/buzz.bookhive.deleteAccount", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `sid=${await sealData({ did }, { password: getSessionConfig().password })}`,
      },
      body: JSON.stringify({ confirmHandle: handle }),
    });
  }

  const successful = remove(successDid, "success.test");
  await entered[successDid].promise;
  const failed = remove(failureDid, "failure.test");
  await entered[failureDid].promise;
  // Finish the first request while the second owns the newest request context.
  finish[successDid].resolve();
  const successResponse = await successful;
  expect(successResponse.status).toBe(200);
  expect(successResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  finish[failureDid].resolve();
  const failureResponse = await failed;
  expect(failureResponse.status).toBe(500);
  expect(failureResponse.headers.get("set-cookie")).toBeNull();
  expect(errors.get(successDid)).toBeUndefined();
  expect(errors.get(failureDid)).toBe(failure);
  expect(events.get(successDid)).toMatchObject({
    userDid: successDid,
    account_delete: "completed",
  });
  expect(events.get(failureDid)).toMatchObject({ userDid: failureDid, account_delete: "failed" });
  expect(revoked).toEqual([successDid]);
});
