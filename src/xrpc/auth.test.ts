/**
 * Service auth on /xrpc/*.
 *
 * The verifier is NOT stubbed: a real `ServiceJwtVerifier` runs against a real
 * `createServiceJwt`-signed token, with a static resolver standing in for the
 * network, so it exercises every check the production path runs.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "unstorage";
import { P256PrivateKeyExportable } from "@atcute/crypto";
import { ServiceJwtVerifier, createServiceJwt } from "@atcute/xrpc-server/auth";
import type { Did, Nsid } from "@atcute/lexicons";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { AppEnv } from "../context";
import { migrateToLatest, type DatabaseSchema, type Database } from "../db";
import { makeEpub } from "../core/bookMetadata/testFixtures";
import { personalBookDir } from "../data/personalLibrary";
import { createXrpcRouter, type XrpcContext } from "./router";
import { testContext } from "../test/db";

const DID = "did:plc:testuser" as Did;
const STRANGER = "did:plc:neverheardofthem" as Did;
const SERVICE_DID = "did:plc:enu2j5xjlqsjaylv3du4myh4" as Did;

let db: Database;
let kv: Storage;
let keypair: P256PrivateKeyExportable;
let strangerKeypair: P256PrivateKeyExportable;

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const database = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(database, sqlite);
  return database;
}

/** A DID document carrying the given key as its `#atproto` verification method. */
async function didDocFor(did: Did, key: P256PrivateKeyExportable) {
  return {
    id: did,
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: "Multikey",
        controller: did,
        publicKeyMultibase: await key.exportPublicKey("multikey"),
      },
    ],
  };
}

/** Resolves both test identities; the network is never touched. */
async function staticResolver() {
  const docs = new Map<string, unknown>([
    [DID, await didDocFor(DID, keypair)],
    [STRANGER, await didDocFor(STRANGER, strangerKeypair)],
  ]);
  return {
    resolve: async (did: string) => {
      const doc = docs.get(did);
      if (!doc) throw new Error(`no did doc for ${did}`);
      return doc;
    },
  };
}

async function createApp(opts: { audiences?: string[]; maxAge?: number; enabled?: boolean } = {}) {
  const resolver = await staticResolver();
  const verifier =
    opts.enabled === false
      ? null
      : new ServiceJwtVerifier({
          acceptAudiences: (opts.audiences ?? [SERVICE_DID]) as Did[],
          resolver: resolver as never,
          maxAge: opts.maxAge ?? 3600,
        });

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set(
      "ctx",
      testContext({
        db,
        kv,
        // No cookie session: these tests are exclusively about the Bearer path.
        getSessionAgent: async () => null,
        addWideEventContext: () => {},
        serviceJwtVerifier: verifier,
      }),
    );
    await next();
  });
  createXrpcRouter<XrpcContext>(
    app as never,
    {
      searchBooks: async () => [],
      ensureBookIdentifiersCurrent: async () => {},
      getProfile: async () => null,
    } as never,
  );
  return app;
}

function token(
  opts: {
    lxm?: string;
    audience?: string;
    issuer?: Did;
    key?: P256PrivateKeyExportable;
    expiresIn?: number;
    issuedAt?: number;
  } = {},
) {
  return createServiceJwt({
    keypair: opts.key ?? keypair,
    issuer: opts.issuer ?? DID,
    audience: (opts.audience ?? SERVICE_DID) as Did,
    lxm: (opts.lxm ?? "buzz.bookhive.listPersonalShelves") as Nsid,
    ...(opts.expiresIn !== undefined ? { expiresIn: opts.expiresIn } : {}),
    ...(opts.issuedAt !== undefined ? { issuedAt: opts.issuedAt } : {}),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  kv = createStorage({ driver: memoryDriver() });
  keypair = await P256PrivateKeyExportable.createKeypair();
  strangerKeypair = await P256PrivateKeyExportable.createKeypair();
});

afterEach(async () => {
  await rm(path.dirname(personalBookDir(DID, "x")), { recursive: true, force: true }).catch(
    () => {},
  );
});

describe("service auth — the happy path", () => {
  it("authenticates a query with a Bearer service token", async () => {
    const app = await createApp();
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { totalBooks: number }).toHaveProperty("totalBooks", 0);
  });

  it("authenticates an upload, the whole point of the feature", async () => {
    const app = await createApp();
    const bytes = makeEpub({ title: "Dune" });
    const res = await app.request("/xrpc/buzz.bookhive.uploadPersonalBook?filename=Dune.epub", {
      method: "POST",
      body: bytes as BodyInit,
      headers: {
        authorization: `Bearer ${await token({ lxm: "buzz.bookhive.uploadPersonalBook" })}`,
        "content-type": "application/epub+zip",
        "content-length": String(bytes.length),
      },
    });
    expect(res.status).toBe(200);

    // And the row landed under the token's issuer, not some other DID.
    const row = await db
      .selectFrom("personal_book")
      .select(["userDid", "title"])
      .executeTakeFirstOrThrow();
    expect(row.userDid).toBe(DID);
    expect(row.title).toBe("Dune");
  });

  it("accepts the #fragment audience form as well as the bare DID", async () => {
    // atcute compares audiences by exact string, so both spellings must be listed.
    const app = await createApp({ audiences: [SERVICE_DID, `${SERVICE_DID}#bookhive_appview`] });
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: {
        authorization: `Bearer ${await token({ audience: `${SERVICE_DID}#bookhive_appview` })}`,
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("service auth — rejections", () => {
  const cases: { name: string; make: () => Promise<string>; lxm?: string }[] = [
    {
      name: "a token minted for a different audience",
      make: () => token({ audience: "did:web:someone-else.example" }),
    },
    {
      name: "a token bound to a different method",
      make: () => token({ lxm: "buzz.bookhive.getPersonalLibrary" }),
    },
    {
      name: "an expired token",
      make: () => token({ issuedAt: Math.floor(Date.now() / 1000) - 600, expiresIn: 60 }),
    },
    {
      name: "a token signed by the wrong key",
      // Issued as DID but signed with the stranger's key, so it can't verify.
      make: () => token({ key: strangerKeypair }),
    },
  ];

  for (const c of cases) {
    it(`401s ${c.name}`, async () => {
      const app = await createApp();
      const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
        headers: { authorization: `Bearer ${await c.make()}` },
      });
      expect(res.status).toBe(401);
    });
  }

  it("401s a token whose signature does not cover its payload", async () => {
    // Splice a different token's signature onto this one's header+payload,
    // rather than flipping a base64url char — flipping padding bits can decode
    // to the same signature bytes, which made this test flaky.
    const app = await createApp();
    const [header, payload] = (await token()).split(".");
    const [, , otherSig] = (await token({ key: strangerKeypair })).split(".");
    const forged = `${header}.${payload}.${otherSig}`;

    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });

  it("401s a token older than the configured max-age window", async () => {
    const app = await createApp({ maxAge: 300 });
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: { authorization: `Bearer ${await token({ expiresIn: 3600 })}` },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token from any DID, including one that has never used BookHive", async () => {
    // There is no prior-relationship gate: a valid token is sufficient, and the
    // per-user storage quota is the backstop on what a caller can consume.
    const app = await createApp();
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: {
        authorization: `Bearer ${await token({ issuer: STRANGER, key: strangerKeypair })}`,
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { totalBooks: number }).toHaveProperty("totalBooks", 0);
  });

  it("401s garbage in the Authorization header", async () => {
    const app = await createApp();
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("401s when service auth is disabled", async () => {
    const app = await createApp({ enabled: false });
    const res = await app.request("/xrpc/buzz.bookhive.listPersonalShelves", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { message: string }).message).toContain("not enabled");
  });
});

describe("service auth — what it deliberately cannot do", () => {
  it("refuses a method that writes to the user's repo", async () => {
    // createList writes to the caller's repo, which needs an OAuth grant —
    // a service token only proves key control.
    const app = await createApp();
    const res = await app.request("/xrpc/buzz.bookhive.createList", {
      method: "POST",
      body: JSON.stringify({ name: "Sci-Fi" }),
      headers: {
        authorization: `Bearer ${await token({ lxm: "buzz.bookhive.createList" })}`,
        "content-type": "application/json",
      },
    });
    expect(res.status).toBe(401);
    const message = ((await res.json()) as { message: string }).message;
    expect(message).toContain("OAuth session");
  });
});
