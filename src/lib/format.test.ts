/**
 * The small formatting helpers that were each written out two or three times
 * before being lifted here. They have no dependencies and no I/O, so the only
 * thing that can go wrong is a boundary — which is exactly what the copies
 * would have drifted on.
 */
import { describe, it, expect } from "bun:test";
import { buildUrl } from "./buildUrl";
import { formatBytes } from "./formatBytes";
import { formatCount } from "./formatCount";
import { parseHtmlToText } from "./htmlToText";
import { escapeXml } from "./xml";

describe("formatBytes", () => {
  it("switches unit at each 1024 boundary", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 ** 2 - 1)).toBe("1024 KB");
    expect(formatBytes(1024 ** 2)).toBe("1 MB");
    expect(formatBytes(1024 ** 3 - 1)).toBe("1024 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("shows one decimal for GB and none below", () => {
    // The quota is 2 GB, so this is the range users actually read.
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
    expect(formatBytes(1.55 * 1024 ** 3)).toBe("1.6 GB");
    expect(formatBytes(3.7 * 1024 ** 2)).toBe("4 MB");
  });

  it("stays byte-identical to the app's copy, which renders the same number", () => {
    // `app/utils/personalLibrary.ts` holds a deliberate copy (Metro cannot
    // import from src/). If they diverge, the server's 413 message and the
    // meter the app draws under it disagree about how full the library is.
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
    expect(formatBytes(3_145_728)).toBe("3 MB");
  });
});

describe("formatCount", () => {
  it("is exact below ten", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(9)).toBe("9");
  });

  it("buckets to tens, then hundreds, then thousands", () => {
    expect(formatCount(10)).toBe("10+");
    expect(formatCount(99)).toBe("90+");
    expect(formatCount(100)).toBe("100+");
    expect(formatCount(999)).toBe("900+");
    expect(formatCount(1000)).toBe("1k+");
    expect(formatCount(12_345)).toBe("12k+");
  });

  it("always rounds down, never up", () => {
    // The counts come from cached aggregates that can lag the table. A chip
    // that undersells is honest; one that oversells is not.
    for (const n of [11, 19, 101, 199, 1001, 1999]) {
      const shown = parseInt(formatCount(n), 10) * (formatCount(n).includes("k") ? 1000 : 1);
      expect(shown).toBeLessThanOrEqual(n);
    }
  });
});

describe("buildUrl", () => {
  it("returns the bare path when every param is empty", () => {
    expect(buildUrl("/explore", { lang: undefined, sort: null, q: "" })).toBe("/explore");
  });

  it("drops only the empty params, keeping the rest", () => {
    // This is what lets a caller pass `lang` unconditionally.
    expect(buildUrl("/authors/X", { page: 2, lang: undefined })).toBe("/authors/X?page=2");
  });

  it("keeps zero, which is not empty", () => {
    expect(buildUrl("/x", { page: 0 })).toBe("/x?page=0");
  });

  it("percent-encodes values", () => {
    expect(buildUrl("/explore", { lang: "Português", q: "a&b" })).toBe(
      "/explore?lang=Portugu%C3%AAs&q=a%26b",
    );
  });

  it("coerces numbers, so a page can be passed either way", () => {
    // The three pagers this replaced disagreed here: one passed `page` as a
    // string and the others as a number, producing different URLs for the same
    // navigation.
    expect(buildUrl("/x", { page: 3 })).toBe(buildUrl("/x", { page: "3" }));
  });
});

describe("escapeXml", () => {
  it("escapes all five predefined entities", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    // `&` → `&amp;` must happen before `<` → `&lt;`, or the `&` introduced by
    // the second replacement gets escaped again.
    expect(escapeXml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeXml("Dune")).toBe("Dune");
    expect(escapeXml("")).toBe("");
  });
});

describe("parseHtmlToText", () => {
  it("turns <br> into a newline and drops other tags", () => {
    expect(parseHtmlToText("<p>one<br/>two</p>")).toBe("one\ntwo");
    expect(parseHtmlToText("<p>one<br>two</p>")).toBe("one\ntwo");
  });

  it("decodes the entities a scraped description actually contains", () => {
    expect(parseHtmlToText("Tom &amp; Jerry &#39;s &quot;book&quot;&nbsp;here")).toBe(
      `Tom & Jerry 's "book" here`,
    );
  });

  it("collapses a run of three or more newlines to a paragraph break", () => {
    expect(parseHtmlToText("a\n\n\nb")).toBe("a\n\nb");
  });

  it("trims, and tolerates a non-string", () => {
    expect(parseHtmlToText("  <p>x</p>  ")).toBe("x");
    expect(parseHtmlToText("")).toBe("");
    expect(parseHtmlToText(null as unknown as string)).toBe("");
  });
});
