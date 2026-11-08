import type { SessionClient } from "../auth/client";
import { Book as BookRecord, ids } from "../bsky/lexicon";
import type { ComAtprotoRepoListRecords } from "@atcute/atproto";

/** Import needs only book records, never the user's entire social repository CAR. */
export async function getImportBookRecords({ agent }: { agent: SessionClient }) {
  const books = new Map<string, BookRecord.Record>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: {
        repo: agent.did,
        collection: ids.BuzzBookhiveBook,
        limit: 100,
        cursor,
        reverse: false,
      },
    });
    // Never mistake a failed/partial traversal for an empty library: that
    // would create duplicates rather than respecting existing PDS records.
    if (!res.ok) throw new Error("Could not read your existing books from your PDS");
    const page = res.data as ComAtprotoRepoListRecords.$output;
    for (const record of page.records) {
      const book = BookRecord.validateRecord(record.value);
      if (!book.success) continue;
      const rkey = record.uri.slice(record.uri.lastIndexOf("/") + 1);
      books.set(rkey, book.value);
    }
    cursor = page.cursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("PDS book pagination did not advance");
      seenCursors.add(cursor);
    }
  } while (cursor);
  return { books };
}
