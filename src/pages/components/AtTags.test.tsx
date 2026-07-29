import { describe, it, expect } from "bun:test";

import { AtTags, type AtTagsProps } from "./AtTags";

/** Render AtTags to its HTML string. */
function render(props: AtTagsProps): string {
  return String(AtTags(props));
}

/** Extract [name, content] pairs from the rendered `<meta at:...>` tags. */
function metas(html: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const re = /<meta name="(at:[^"]+)" content="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    pairs.push([m[1]!, m[2]!]);
  }
  return pairs;
}

describe("AtTags", () => {
  it("emits nothing when given no values", () => {
    expect(metas(render({}))).toEqual([]);
  });

  it("renders canonical and alternate records", () => {
    const html = render({
      canonical: "at://did:plc:x/buzz.bookhive.catalogBook/1",
      alternate: "at://did:plc:y/buzz.bookhive.buzz/2",
    });
    expect(metas(html)).toEqual([
      ["at:canonical", "at://did:plc:x/buzz.bookhive.catalogBook/1"],
      ["at:alternate", "at://did:plc:y/buzz.bookhive.buzz/2"],
    ]);
  });

  it("follows array semantics — one tag per value", () => {
    const html = render({ canonical: ["at://did:plc:a/c/1", "at://did:plc:b/c/2"] });
    expect(metas(html)).toEqual([
      ["at:canonical", "at://did:plc:a/c/1"],
      ["at:canonical", "at://did:plc:b/c/2"],
    ]);
  });

  it("wraps bare DIDs as at:// URIs for author and me", () => {
    const html = render({ author: "did:plc:author", me: "did:plc:site" });
    expect(metas(html)).toEqual([
      ["at:author", "at://did:plc:author"],
      ["at:me", "at://did:plc:site"],
    ]);
  });

  it("leaves already-qualified DID URIs untouched", () => {
    const html = render({ author: "at://did:plc:author" });
    expect(metas(html)).toEqual([["at:author", "at://did:plc:author"]]);
  });

  it("drops falsy/empty values (e.g. a null hiveBookAtUri)", () => {
    expect(metas(render({ canonical: null }))).toEqual([]);
    expect(metas(render({ canonical: undefined }))).toEqual([]);
    expect(metas(render({ canonical: "   " }))).toEqual([]);
    expect(metas(render({ canonical: ["at://did:plc:a/c/1", "", null] }))).toEqual([
      ["at:canonical", "at://did:plc:a/c/1"],
    ]);
  });

  it("dedupes repeated values", () => {
    const html = render({ alternate: ["at://did:plc:a/c/1", "at://did:plc:a/c/1"] });
    expect(metas(html)).toEqual([["at:alternate", "at://did:plc:a/c/1"]]);
  });

  it("emits namespaced custom properties", () => {
    const html = render({
      custom: { "blog:comments": "at://did:plc:a/app.bsky.feed.post/1" },
    });
    expect(metas(html)).toEqual([["at:blog:comments", "at://did:plc:a/app.bsky.feed.post/1"]]);
  });
});
