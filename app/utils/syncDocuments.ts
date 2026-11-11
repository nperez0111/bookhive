import type { SyncDoc } from "@/api/personalLibraryTypes";

export function documentTitle(doc: SyncDoc): string {
  return doc.title || doc.filename || "Untitled document";
}

/** Documents with files are already represented by file cards, never duplicate them. */
export function partitionSyncDocuments(documents: SyncDoc[]) {
  const loose = documents.filter((doc) => !doc.hasFile);
  return {
    needsTriage: loose.filter((doc) => !doc.hiveId && !doc.dismissed),
    tracked: loose.filter((doc) => doc.hiveId || doc.dismissed),
  };
}
