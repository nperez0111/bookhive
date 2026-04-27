/**
 * Ingester worker — runs the Jetstream firehose + backfill processing
 * in a separate thread to keep the main HTTP thread responsive.
 *
 * Communicates back to the main thread via postMessage for wide-event logging.
 */
import { createDb } from "../db";
import pgKv from "../pg-kv";
import { createIngester } from "../bsky/ingester";
import { createServiceAccountAgent } from "../utils/catalogBookService";
import { env } from "../env";
import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

// Own DB connection pool (workers can't share pools across threads)
const { db, pool } = createDb(env.DATABASE_URL);

const kv = createStorage({
  driver: pgKv({ table: "kv", pool }),
});

if (env.isProd) {
  kv.mount("search:", lruCacheDriver({ max: 1000 }));
}
kv.mount("profile:", pgKv({ table: "kv_profile", pool }));
kv.mount("identity:", pgKv({ table: "kv_identity", pool }));
kv.mount("follows_sync:", pgKv({ table: "kv_follows_sync", pool }));
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
