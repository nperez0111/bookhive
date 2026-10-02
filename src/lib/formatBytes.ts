/**
 * Human-readable byte count for the storage quota.
 *
 * Lives in its own module (not `personalLibrary.ts`, which owns the quota
 * itself) because a client island needs it too, and that module reaches for
 * `fs`. `app/utils/personalLibrary.ts` holds a deliberate byte-identical copy
 * — Metro can't import from `src/` — so the server's 413 message and the
 * app's meter agree on the same number.
 *
 * Not the same as `formatFileSize` in `client/components/library/types.ts`,
 * which is per-file rather than per-library and legitimately rounds differently.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
