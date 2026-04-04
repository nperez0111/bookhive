/**
 * Ingester worker — runs the Jetstream firehose + backfill processing
 * in a separate thread to keep the main HTTP thread responsive.
 *
 * Communicates back to the main thread via postMessage for wide-event logging.
 */
import { createDb } from "../db";
import sqliteKv, { createSharedKvDb } from "../sqlite-kv";
import { createIngester } from "../bsky/ingester";
import { createServiceAccountAgent } from "../utils/catalogBookService";
import { env } from "../env";
import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

// Open own DB connections (workers can't share DatabaseSync across threads)
const { db } = createDb(env.DB_PATH);

const kvDb = createSharedKvDb(env.KV_DB_PATH);
const kv = createStorage({
  driver: sqliteKv({ table: "kv", db: kvDb }),
});

if (env.isProd) {
  kv.mount("search:", lruCacheDriver({ max: 1000 }));
}
kv.mount("profile:", sqliteKv({ table: "profile", db: kvDb }));
kv.mount("identity:", sqliteKv({ table: "identity", db: kvDb }));
kv.mount("follows_sync:", sqliteKv({ table: "follows_sync", db: kvDb }));
kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

const serviceAccountAgent =
  env.BOOKHIVE_SERVICE_HANDLE && env.BOOKHIVE_APP_PASSWORD
    ? await createServiceAccountAgent(env.BOOKHIVE_SERVICE_HANDLE, env.BOOKHIVE_APP_PASSWORD)
    : null;

const ingester = createIngester(db, kv, serviceAccountAgent, (wideEvent) => {
  postMessage({ type: "wideEvent", payload: wideEvent });
});

ingester.start();
postMessage({ type: "ready" });
