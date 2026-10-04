import { FINISHED, READING } from "../../constants";

/** Initial My Books order, shared by the server fallback and interactive workspace. */
export function compareTrackedBooks(
  a: { status: string | null; finishedAt: string | null; createdAt: string },
  b: { status: string | null; finishedAt: string | null; createdAt: string },
): number {
  const aIsReading = a.status === READING;
  const bIsReading = b.status === READING;
  if (aIsReading !== bIsReading) return aIsReading ? -1 : 1;

  if (a.status === FINISHED && b.status === FINISHED) {
    if (!a.finishedAt && !b.finishedAt) return 0;
    if (!a.finishedAt) return 1;
    if (!b.finishedAt) return -1;
    return new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime();
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
