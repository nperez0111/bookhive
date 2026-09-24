import type { Database as DatabaseSync } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { createTestDb } from "../test/db";
import type { Database } from "../db";
import { pruneMirroredRecords } from "./repoMirror";

let db: Database;
let sqlite: DatabaseSync;

beforeEach(async () => {
  ({ db, sqlite } = await createTestDb());
});

afterEach(async () => {
  await db.destroy();
});

const ME = "did:plc:me";
const OTHER = "did:plc:other";

function insertBuzz(uri: string, userDid: string) {
  const now = new Date().toISOString();
  sqlite.exec(
    `INSERT INTO buzz
       (uri, cid, userDid, createdAt, indexedAt, hiveId, comment,
        bookUri, bookCid, parentUri, parentCid)
     VALUES (?1, 'cid', ?2, ?3, ?3, 'bk_a', 'hi', 'at://x', 'cid', 'at://p', 'cid')`,
    [uri, userDid, now],
  );
}

const remaining = async (userDid: string) =>
  (await db.selectFrom("buzz").select("uri").where("userDid", "=", userDid).execute()).map(
    (r) => r.uri,
  );

describe("pruneMirroredRecords", () => {
  it("deletes everything the PDS did not return", async () => {
    insertBuzz("at://me/1", ME);
    insertBuzz("at://me/2", ME);
    insertBuzz("at://me/3", ME);

    await pruneMirroredRecords({ db, table: "buzz", userDid: ME, keepUris: ["at://me/2"] });

    expect(await remaining(ME)).toEqual(["at://me/2"]);
  });

  it("an empty keep list deletes all of the user's rows", async () => {
    // The admin re-sync used to guard the whole delete on `keepUris.length > 0`, so deleting every comment became a no-op and every deletion stayed visible permanently.
    insertBuzz("at://me/1", ME);
    insertBuzz("at://me/2", ME);

    const deleted = await pruneMirroredRecords({ db, table: "buzz", userDid: ME, keepUris: [] });

    expect(deleted).toBe(2);
    expect(await remaining(ME)).toEqual([]);
  });

  it("never touches another user's rows, in either branch", async () => {
    insertBuzz("at://me/1", ME);
    insertBuzz("at://other/1", OTHER);

    await pruneMirroredRecords({ db, table: "buzz", userDid: ME, keepUris: [] });
    expect(await remaining(OTHER)).toEqual(["at://other/1"]);

    insertBuzz("at://me/2", ME);
    await pruneMirroredRecords({ db, table: "buzz", userDid: ME, keepUris: ["at://me/2"] });
    expect(await remaining(OTHER)).toEqual(["at://other/1"]);
  });

  it("keeping everything deletes nothing", async () => {
    insertBuzz("at://me/1", ME);
    insertBuzz("at://me/2", ME);

    const deleted = await pruneMirroredRecords({
      db,
      table: "buzz",
      userDid: ME,
      keepUris: ["at://me/1", "at://me/2"],
    });

    expect(deleted).toBe(0);
    expect((await remaining(ME)).sort()).toEqual(["at://me/1", "at://me/2"]);
  });
});
