/**
 * Patch `cover` and `hiveBookUri` onto a book record after the response.
 *
 * BookHive renders neither from the record, but the cover costs three network
 * hops plus a decode and the catalogue link can mean a 20s scrape — nobody
 * clicking a status should wait for that. The patch is CAS'd on the cid the
 * request wrote; on conflict it re-reads the winner and re-applies on top,
 * because losing that race to the user's own next edit is the *common* case
 * (a first add followed by a rating click, while the cover is still
 * uploading) and no later write re-supplies the cover — dropping the patch
 * lost it for good. The request's wide event is long gone by the time this
 * resolves, so the counter is the only signal.
 */
import type { SessionClient } from "../auth/client";
import type { BookUtilContext } from "../context";
import { LABEL, userBookFollowUpTotal } from "../metrics";
import type { BookRecordValue, UserBook } from "../types";
import { getBookRecord, INVALID_SWAP, writeBookRecord } from "./bookRecordWrite";
import { ensureBookCataloged } from "./ensureBookCataloged";
import { Semaphore, withTimeout } from "./semaphore";
import { uploadImageBlob } from "./uploadImageBlob";

export type FollowUpOutcome = "completed" | "nothing" | "conflict" | "failed";

const FOLLOW_UP_CONCURRENCY = 2;
/** Cover fetch (10s) + resize + upload, or enrich (10s) + catalog (10s), then one write. */
const FOLLOW_UP_DEADLINE_MS = 60_000;

/** Shed rather than queue without bound; each waiter holds a record. */
const FOLLOW_UP_MAX_PENDING = 64;

/** CAS attempts per follow-up. Each retry is one getRecord + one putRecord. */
const MAX_CAS_ATTEMPTS = 3;

const slots = new Semaphore(FOLLOW_UP_CONCURRENCY, {
  label: "user_book_follow_up",
  maxPending: FOLLOW_UP_MAX_PENDING,
});
const inFlight = new Map<string, Promise<FollowUpOutcome>>();

export function followUpNeeds(
  record: BookRecordValue,
  { coverImage, canCatalog }: { coverImage: string | undefined; canCatalog: boolean },
): { cover: boolean; catalog: boolean } {
  return {
    cover: !record.cover && !!coverImage,
    catalog: !record.hiveBookUri && canCatalog,
  };
}

/** Never rejects: request handlers drop it, tests await it. */
export function completeUserBookRecord({
  ctx,
  agent,
  userBook,
  coverImage,
}: {
  ctx: BookUtilContext;
  agent: Pick<SessionClient, "did" | "post" | "get">;
  userBook: UserBook;
  coverImage: string | undefined;
}): Promise<FollowUpOutcome> {
  const record = userBook.record;
  if (!record) return Promise.resolve("nothing");
  const needs = followUpNeeds(record, { coverImage, canCatalog: !!ctx.serviceAccountAgent });
  if (!needs.cover && !needs.catalog) return Promise.resolve("nothing");

  const existing = inFlight.get(userBook.uri);
  if (existing) return existing;

  const run = async (): Promise<FollowUpOutcome> => {
    const patch: Partial<BookRecordValue> = {};
    if (needs.cover) {
      const blob = await uploadImageBlob(coverImage, agent, 800);
      if (blob) patch.cover = blob as BookRecordValue["cover"];
    }
    if (needs.catalog) {
      const hiveBookUri = await ensureBookCataloged(ctx, userBook.hiveId);
      if (hiveBookUri) patch.hiveBookUri = hiveBookUri;
    }
    if (Object.keys(patch).length === 0) return "nothing";

    const rkey = userBook.uri.split("/").at(-1)!;
    // The expensive work (blob upload, scrape) is done; only the write is
    // retried. Start from the snapshot the request wrote; after a lost race,
    // re-read whatever won and patch on top of that instead.
    let target = { record, cid: userBook.cid };
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      // Only patch what the target still lacks — the race winner may have
      // brought its own catalogue link.
      const missing: Partial<BookRecordValue> = {};
      if (patch.cover && !target.record.cover) missing.cover = patch.cover;
      if (patch.hiveBookUri && !target.record.hiveBookUri) {
        missing.hiveBookUri = patch.hiveBookUri;
      }
      if (Object.keys(missing).length === 0) return "completed";

      const patched: BookRecordValue = { ...target.record, ...missing };
      const written = await writeBookRecord({
        agent,
        rkey,
        record: patched,
        swapRecord: target.cid,
      });
      if (written.ok) {
        // Only the fields this task owns, and only while the row is the one we
        // patched. Replaying the whole row reverted column-only writes made
        // during the window — `owned` from an upload (guarded on `owned = 0`,
        // so it never re-fires) and KOSync progress. Those columns aren't in
        // the record, so the CAS can't protect them.
        await ctx.db
          .updateTable("user_book")
          .set({
            cid: written.cid,
            indexedAt: new Date().toISOString(),
            record: JSON.stringify(patched),
          })
          .where("uri", "=", userBook.uri)
          .where("cid", "=", target.cid)
          .execute();
        return "completed";
      }
      if (written.error !== INVALID_SWAP) {
        throw new Error(`follow-up write failed: ${written.error} ${written.message ?? ""}`);
      }
      if (attempt === MAX_CAS_ATTEMPTS - 1) break;
      const fresh = await getBookRecord({ agent, uri: userBook.uri });
      // Gone from the PDS: the user removed the book while we worked.
      if (!fresh) return "conflict";
      target = { record: fresh.value, cid: fresh.cid };
    }
    return "conflict";
  };

  const task: Promise<FollowUpOutcome> = (async () => {
    // Held until the work settles, not until the deadline: nothing in `run` is
    // cancellable, so releasing early lets a new follow-up start alongside it.
    const release = await slots.acquireSlot();
    const running = run();
    void running.then(release, release);
    return withTimeout(running, FOLLOW_UP_DEADLINE_MS, `follow-up ${userBook.uri}`);
  })()
    .catch((): FollowUpOutcome => "failed")
    .then((outcome) => {
      userBookFollowUpTotal.inc(LABEL.userBookFollowUp[outcome]);
      return outcome;
    })
    .finally(() => {
      inFlight.delete(userBook.uri);
    });
  inFlight.set(userBook.uri, task);
  return task;
}
