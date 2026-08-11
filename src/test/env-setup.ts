/**
 * Bun test preload — runs before any test file's imports, and therefore before
 * `src/env.ts` is evaluated.
 *
 * This is load-bearing rather than cosmetic. `env` is frozen by envalid at
 * import time, so a test can neither assign to it nor usefully mutate
 * `process.env` afterwards (ESM imports hoist). Without this file `DB_PATH`
 * falls back to its `devDefault` of `":memory:"`, which makes
 * `getLibraryDir()` resolve to `path.dirname(":memory:") + "/library"` —
 * i.e. `./library` **inside the repo working tree**. The first test that
 * actually exercises an upload would write ebooks into the checkout.
 *
 * Both paths are set with `??=` so an explicit env var (CI, a targeted debug
 * run) still wins.
 */
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.join(tmpdir(), "bookhive-test", String(process.pid));

process.env["DB_PATH"] ??= path.join(root, "db.sqlite");
process.env["LIBRARY_DIR"] ??= path.join(root, "library");
