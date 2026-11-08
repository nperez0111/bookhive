import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon/index";
import type { Database } from "../db";
import { sql } from "kysely";
import { removeUserDir } from "../data/personalLibrary";

type ListRecordsOut = {
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
};

const PDS_BATCH_LIMIT = 200;
const PDS_SCAN_PAGE_LIMIT = 500;

async function listAllRecordUris(agent: SessionClient, collection: string): Promise<string[]> {
  const uris: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < PDS_SCAN_PAGE_LIMIT; page++) {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: { repo: agent.did, collection, limit: 100, cursor },
    });
    if (!res.ok) throw new Error(`Failed to list ${collection} records from PDS`);
    const data = res.data as ListRecordsOut;
    for (const record of data.records) {
      uris.push(record.uri);
    }
    cursor = data.cursor;
    if (!cursor) return uris;
    if (seenCursors.has(cursor)) {
      throw new Error(`Repeated cursor while listing ${collection} records from PDS`);
    }
    seenCursors.add(cursor);
  }
  throw new Error(
    `Could not finish listing ${collection} records within ${PDS_SCAN_PAGE_LIMIT} pages`,
  );
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

/** Delete all BookHive data for a user from both PDS and local database. */
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
    await trx.deleteFrom("user_follows").where("userDid", "=", did).execute();
    // Preserve a generation even for an empty graph: an older scan must not
    // republish follows after this cleanup commits.
    await trx
      .insertInto("follow_sync_state")
      .values({ userDid: did, revision: 1 })
      .onConflict((oc) => oc.column("userDid").doUpdateSet({ revision: sql<number>`revision + 1` }))
      .execute();
    await trx.deleteFrom("progress_history").where("userDid", "=", did).execute();
    await trx.deleteFrom("sync_write_queue").where("userDid", "=", did).execute();
    // A leftover legacy KV array must not resurrect work. This does not cancel remote writes.
    await trx
      .insertInto("sync_write_state")
      .values({ userDid: did, legacyImported: 1, leaseToken: null, leaseUntil: null })
      .onConflict((oc) => oc.column("userDid").doUpdateSet({ legacyImported: 1 }))
      .execute();
  });

  // Remove uploaded library files from disk
  // The settings adapter retains the session on failure so a retry can finish cleanup.
  await removeUserDir(did);
}
