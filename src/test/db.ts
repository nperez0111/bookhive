import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage, type Storage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import type { AppContext } from "../context";

/**
 * A migrated in-memory database, and a context shaped like the real one.
 *
 * 21 test files hand-rolled the same four lines — `new DatabaseSync(":memory:")`
 * → `PRAGMA journal_mode = WAL` → `new Kysely({ SqliteDialect(wrapBunSqliteForKysely(…)) })`
 * → `migrateToLatest` — and six of them then built a fake `AppContext` behind
 * `as unknown as AppContext`. That cast is why a change to the context shape
 * could never fail a test: it explicitly tells the compiler not to look.
 */

/** Migrated, in-memory, WAL. `sqlite` is exposed for `EXPLAIN QUERY PLAN`. */
export async function createTestDb(): Promise<{
  db: Database;
  sqlite: DatabaseSync;
  close: () => Promise<void>;
}> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return { db, sqlite, close: () => db.destroy() };
}

/** A fresh in-memory KV, the same `unstorage` interface production uses. */
export const testKv = (): Storage => createStorage({ driver: memoryDriver() });

/**
 * `ingester` and `oauthClient` are the two fields a unit test cannot honestly
 * stub — one owns a live Jetstream websocket, the other an OAuth client with
 * real keys — and nothing below the transports touches either. They are the
 * *only* part of the context that is cast; everything else in `stubs` below is
 * checked against the real `AppContext`, so a field that changes shape breaks
 * this file rather than passing silently in six others.
 */
type StubbableContext = Omit<AppContext, "ingester" | "oauthClient">;

/**
 * An `AppContext` with a working `db`/`kv` and inert defaults for everything a
 * unit test does not exercise: signed out, no PDS, nothing cached.
 *
 * `overrides` is a real `Partial<AppContext>`, so whatever a test *does* supply
 * is type-checked against production's shape.
 */
export function testContext(overrides: Partial<AppContext> & { db: Database }): AppContext {
  const wideEvent: Record<string, unknown> = {};
  const stubs: Omit<StubbableContext, "db"> = {
    kv: testKv(),
    getSessionDid: async () => null,
    getSessionAgent: async () => null,
    getProfile: async () => null,
    serviceAccountAgent: null,
    serviceJwtVerifier: null,
    addWideEventContext: (fields) => Object.assign(wideEvent, fields),
    resolver: {
      resolveDidToHandle: async (did: string) => `${did.split(":").at(-1)}.test`,
      resolveDidsToHandles: async (dids: string[]) =>
        Object.fromEntries(dids.map((d) => [d, `${d.split(":").at(-1)}.test`])),
    } as AppContext["resolver"],
    // `BaseIdResolver` is a class with private members, so a structural stub
    // cannot satisfy it — this one goes through `unknown`. Tests that need
    // handle resolution pass their own via `overrides`.
    baseIdResolver: {
      handle: { resolve: async () => undefined },
    } as unknown as AppContext["baseIdResolver"],
  };
  return { ...stubs, ...overrides } as AppContext;
}
