import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon/index";
import type { Database } from "../db";
import { removeUserDir } from "../data/personalLibrary";

type ListRecordsOut = {
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
};

const PDS_BATCH_LIMIT = 200;

async function listAllRecordUris(agent: SessionClient, collection: string): Promise<string[]> {
  const uris: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: { repo: agent.did, collection, limit: 100, cursor },
    });
    if (!res.ok) throw new Error(`Failed to list ${collection} records from PDS`);
    const data = res.data as ListRecordsOut;
    for (const record of data.records) {
      uris.push(record.uri);
    }
    cursor = data.cursor;
  } while (cursor);
  return uris;
}

async function batchDeleteFromPds(
  agent: SessionClient,
  collection: string,
  uris: string[],
): Promise<void> {
  const writes = uris.map((uri) => ({
    $type: "com.atproto.repo.applyWrites#delete" as const,
    collection,
    rkey: uri.split("/").at(-1)!,
  }));

  for (let i = 0; i < writes.length; i += PDS_BATCH_LIMIT) {
    const res = await agent.post("com.atproto.repo.applyWrites", {
      input: { repo: agent.did, writes: writes.slice(i, i + PDS_BATCH_LIMIT) },
    });
    if (!res.ok) throw new Error(`Failed to delete ${collection} records from PDS`);
  }
}

/**
 * Delete BookHive records, local rows and uploaded files (not Bluesky posts).
 * These systems cannot share a transaction: PDS batches may partially succeed,
 * and a later DB or filesystem failure cannot undo earlier deletions. Failures
 * must reach the caller; retrying resumes from the remaining records/files.
 */
export async function deleteAccountData({
  agent,
  db,
}: {
  agent: SessionClient;
  db: Database;
}): Promise<void> {
  // PDS cleanup first (order: items before parents)
  const collections = [
    ids.SocialPopfeedFeedListItem,
    ids.SocialPopfeedFeedList,
    ids.BuzzBookhiveBuzz,
    ids.BuzzBookhiveBook,
  ];

  for (const collection of collections) {
    const uris = await listAllRecordUris(agent, collection);
    if (uris.length > 0) {
      await batchDeleteFromPds(agent, collection, uris);
    }
  }

  const did = agent.did;
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("personal_shelf_item")
      .where("shelfId", "in", (qb) =>
        qb.selectFrom("personal_shelf").select("id").where("userDid", "=", did),
      )
      .execute();
    await trx.deleteFrom("personal_shelf").where("userDid", "=", did).execute();
    await trx.deleteFrom("personal_book").where("userDid", "=", did).execute();
    await trx.deleteFrom("sync_document").where("userDid", "=", did).execute();
    await trx.deleteFrom("book_list_item").where("userDid", "=", did).execute();
    await trx.deleteFrom("book_list").where("userDid", "=", did).execute();
    await trx.deleteFrom("buzz").where("userDid", "=", did).execute();
    await trx.deleteFrom("user_book").where("userDid", "=", did).execute();
    await trx.deleteFrom("progress_history").where("userDid", "=", did).execute();
    await trx.deleteFrom("user_follows").where("userDid", "=", did).execute();
  });

  // Remove uploaded library files from disk
  // Keep filesystem I/O outside the SQLite write transaction. If it fails, the
  // rows are already gone, but the caller must not claim deletion completed.
  await removeUserDir(did);
}
