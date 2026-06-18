import { describe, expect, test } from "bun:test";
import { extractNextData, parseGoodreadsData } from "../moreInfo";

describe("extractNextData", () => {
  test("extracts book data from a real Goodreads page", async () => {
    const nextDataJson = await Bun.file(
      import.meta.dir + "/__fixtures__/next-data-27833670.json",
    ).text();
    const html = `<script id="__NEXT_DATA__" type="application/json">${nextDataJson}</script>`;

    const result = extractNextData(html);
    expect(result).not.toBeNull();
    expect(result!.book.titleComplete).toBe("Dark Matter");
    expect(result!.book.genres.length).toBeGreaterThan(0);
    expect(result!.book.primaryAuthor.name).toBe("Blake Crouch");
    expect(result!.work.averageRating).toBeGreaterThan(0);
    expect(result!.work.ratingsCount).toBeGreaterThan(0);
  });

  test("returns null for HTML without __NEXT_DATA__", () => {
    const html = "<html><body>No data here</body></html>";
    expect(extractNextData(html)).toBeNull();
  });
});

describe("parseGoodreadsData", () => {
  test("parses series information", async () => {
    const nextDataJson = await Bun.file(
      import.meta.dir + "/__fixtures__/next-data-27833670.json",
    ).text();
    const json = JSON.parse(nextDataJson);
    const result = parseGoodreadsData(json);
    expect(result).not.toBeNull();
    expect(result!.book.details.publisher).toBeDefined();
  });

  test("returns null for invalid data", () => {
    expect(parseGoodreadsData({})).toBeNull();
    expect(parseGoodreadsData({ props: {} })).toBeNull();
    expect(parseGoodreadsData({ props: { pageProps: {} } })).toBeNull();
  });
});
