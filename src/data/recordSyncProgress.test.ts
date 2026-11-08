import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database as SqliteDatabase } from "bun:sqlite";

import { WANTTOREAD } from "../constants";
import { filenameKey } from "../core/filenameMatching";
import type { Database } from "../db";
import { getHiveId } from "../scrapers/getHiveId";
import { createTestDb } from "../test/db";
import type { HiveId } from "../types";
import { recordSyncProgress } from "./syncBridge";
import { NO_HIVE_MATCH } from "./syncMatching";

const DID = "did:plc:record-sync";
const DOCUMENT = "reader-document";
const TITLE = "The Dispossessed";
const AUTHORS = "Ursula K. Le Guin";
const FILENAME = `${AUTHORS} - ${TITLE}.epub`;
const MATCH = getHiveId({ title: TITLE, authors: AUTHORS });
const MANUAL = getHiveId({ title: "Manual winner", authors: AUTHORS });

describe("recordSyncProgress", () => {
  let db: Database;
  let sqlite: SqliteDatabase;

  beforeEach(async () => {
    ({ db, sqlite } = await createTestDb());
  });

  afterEach(async () => {
    await db.destroy();
  });

  const push = (metadata?: { filename?: string; title?: string; authors?: string }) =>
    recordSyncProgress({
      db,
      userDid: DID,
      document: DOCUMENT,
      progress: "/body/section[4]",
      percentage: 0.42,
      device: "reader",
      deviceId: "device-1",
      metadata,
    });

  const readDocument = () => db.selectFrom("sync_document").selectAll().executeTakeFirstOrThrow();

  const seedCatalogue = () =>
    db
      .insertInto("hive_book")
      .values({
        id: MATCH,
        title: TITLE,
        rawTitle: TITLE,
        authors: AUTHORS,
        source: "goodreads",
        thumbnail: "",
        sourceUrl: null,
        sourceId: null,
        cover: null,
        description: null,
        rating: null,
        ratingsCount: null,
        series: null,
        meta: null,
        enrichedAt: null,
        enrichAttempts: 0,
        enrichFailedAt: null,
        identifiers: null,
        language: null,
        hiveBookAtUri: null,
        hiveBookCatalogUpdatedAt: null,
        createdAt: "2026-11-08T00:00:00.000Z",
        updatedAt: "2026-11-08T00:00:00.000Z",
      })
      .execute();

  const track = (hiveId: HiveId) =>
    db
      .insertInto("user_book")
      .values({
        uri: `at://${DID}/buzz.bookhive.book/${hiveId}`,
        cid: "cid",
        userDid: DID,
        hiveId,
        title: TITLE,
        authors: AUTHORS,
        status: WANTTOREAD,
        owned: 0,
        createdAt: "2026-11-08T00:00:00.000Z",
        indexedAt: "2026-11-08T00:00:00.000Z",
      })
      .execute();

  it("atomically creates one document for concurrent first pushes and preserves omitted metadata", async () => {
    await Promise.all([push({ filename: FILENAME, title: TITLE }), push({ authors: AUTHORS })]);

    const rows = await db.selectFrom("sync_document").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: FILENAME,
      filenameKey: filenameKey(FILENAME),
      title: TITLE,
      authors: AUTHORS,
      hiveId: null,
    });
    expect(JSON.parse(rows[0]!.progressData).percentage).toBe(0.42);

    await push();
    expect(await readDocument()).toMatchObject({
      filename: FILENAME,
      title: TITLE,
      authors: AUTHORS,
    });
  });

  it("uses the persisted filename to match a later metadata-free push", async () => {
    expect(await push({ filename: FILENAME })).toEqual({ hiveId: null });
    await seedCatalogue();

    expect(await push()).toEqual({ hiveId: MATCH });
    expect(await readDocument()).toMatchObject({ filename: FILENAME, hiveId: MATCH });
  });

  it("does not bridge older progress after a newer push wins during matching", async () => {
    await seedCatalogue();
    await track(MATCH);
    sqlite.exec(`CREATE TRIGGER newer_sync_progress AFTER UPDATE OF hiveId ON sync_document
      WHEN OLD.hiveId IS NULL
      BEGIN
        UPDATE sync_document SET progressData = '{"percentage":0.75}' WHERE id = NEW.id;
        UPDATE user_book SET bookProgress = '{"percent":75}' WHERE hiveId = '${MATCH}';
        INSERT INTO sync_write_queue (userDid,hiveId,revision,bookProgress,enqueuedAt)
          VALUES ('${DID}','${MATCH}','newer','{"percent":75}','');
      END;`);
    expect(await push({ title: TITLE, authors: AUTHORS })).toEqual({ hiveId: MATCH });
    const book = await db.selectFrom("user_book").select("bookProgress").executeTakeFirstOrThrow();
    expect(JSON.parse(book.bookProgress!).percent).toBe(75);
    const queued = await db.selectFrom("sync_write_queue").selectAll().executeTakeFirstOrThrow();
    expect(queued.revision).toBe("newer");
    expect(JSON.parse(queued.bookProgress).percent).toBe(75);
  });

  for (const winner of [MANUAL, NO_HIVE_MATCH]) {
    it(`preserves an existing ${winner === NO_HIVE_MATCH ? "dismissal" : "manual link"} on upsert`, async () => {
      await push({ filename: FILENAME, title: TITLE, authors: AUTHORS });
      await db.updateTable("sync_document").set({ hiveId: winner }).execute();
      await seedCatalogue();

      expect(await push()).toEqual({ hiveId: winner });
      expect(await readDocument()).toMatchObject({
        hiveId: winner,
        filename: FILENAME,
        title: TITLE,
        authors: AUTHORS,
      });
    });

    it(`bridges and returns the persisted ${winner === NO_HIVE_MATCH ? "dismissal" : "manual winner"} when matching loses`, async () => {
      await seedCatalogue();
      await track(MATCH);
      await track(MANUAL);
      // Simulate a manual operation landing after the match read but before its
      // conditional write. RAISE(IGNORE) makes the automatic UPDATE lose.
      sqlite.exec(`
        CREATE TRIGGER manual_sync_winner BEFORE UPDATE OF hiveId ON sync_document
        WHEN OLD.hiveId IS NULL AND NEW.hiveId = '${MATCH}'
        BEGIN
          UPDATE sync_document SET hiveId = '${winner}' WHERE id = OLD.id;
          SELECT RAISE(IGNORE);
        END;
      `);

      expect(await push({ title: TITLE, authors: AUTHORS })).toEqual({ hiveId: winner });
      expect((await readDocument()).hiveId).toBe(winner);
      const books = await db.selectFrom("user_book").select(["hiveId", "bookProgress"]).execute();
      expect(books.find((book) => book.hiveId === MATCH)?.bookProgress).toBeNull();
      const manualProgress = books.find((book) => book.hiveId === MANUAL)?.bookProgress;
      if (winner === MANUAL) {
        expect(JSON.parse(manualProgress ?? "{}").percent).toBe(42);
      } else {
        expect(manualProgress).toBeNull();
      }
    });
  }
});
