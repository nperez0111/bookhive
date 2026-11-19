import { describe, expect, it } from "bun:test";

import { partitionSyncDocs, type SyncDoc } from "./types";

function doc(overrides: Partial<SyncDoc>): SyncDoc {
  return {
    document: "doc",
    title: null,
    authors: null,
    filename: null,
    percentage: 0.5,
    device: null,
    updatedAt: "2026-11-19T00:00:00.000Z",
    hiveId: null,
    bookTitle: null,
    dismissed: false,
    tracked: false,
    hasFile: false,
    ...overrides,
  };
}

describe("partitionSyncDocs", () => {
  it("separates matched-but-unadded, unmatched and already-tracked documents", () => {
    const unadded = doc({ document: "matched", hiveId: "bk_matched" });
    const unlinked = doc({ document: "unmatched" });
    const tracked = doc({ document: "tracked", hiveId: "bk_tracked", tracked: true });
    const dismissed = doc({ document: "dismissed", dismissed: true });
    const hasFile = doc({ document: "file", hiveId: "bk_file", hasFile: true });

    const {
      unadded: add,
      unlinked: link,
      tracked: rest,
    } = partitionSyncDocs([unadded, unlinked, tracked, dismissed, hasFile]);

    expect(add.map((d) => d.document)).toEqual(["matched"]);
    expect(link.map((d) => d.document)).toEqual(["unmatched"]);
    expect(rest.map((d) => d.document)).toEqual(["tracked", "dismissed"]);
  });

  it("puts a matched-untracked document in the add list, not the tracking list", () => {
    const matched = doc({ hiveId: "bk_matched", tracked: false });
    const { unadded, tracked } = partitionSyncDocs([matched]);
    expect(unadded).toHaveLength(1);
    expect(tracked).toHaveLength(0);
  });
});
