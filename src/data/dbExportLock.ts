import { Database } from "bun:sqlite";
import path from "node:path";

// Root ownership independently of an abandoned/disconnected request Promise.
// Bun's Database finalizer must not unlock a still-running native export.
const heldLocks = new Set<Database>();

/** Separate from application DB/KV: never block their writers during a download.
 * The persistent inode must not be unlinked (that would create two lock domains).
 * OS byte-range locks survive no process crash and have no expiring lease race.
 */
export function acquireExportLock(exportDir: string): (() => void) | undefined {
  const db = new Database(path.join(exportDir, ".bookhive-export-lock.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    if (error instanceof Error && "code" in error && error.code === "SQLITE_BUSY") return;
    throw error;
  }
  heldLocks.add(db);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      db.exec("ROLLBACK");
    } finally {
      try {
        db.close();
      } finally {
        heldLocks.delete(db);
      }
    }
  };
}
