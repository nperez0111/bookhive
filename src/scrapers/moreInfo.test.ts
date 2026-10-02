import { describe, expect, test } from "bun:test";
import { extractNextData, parseGoodreadsData } from "./moreInfo";

const FIXTURE = import.meta.dir + "/waf/__fixtures__/next-data-27833670.json";

describe("extractNextData", () => {
  test("extracts book data from a real Goodreads page", async () => {
    const nextDataJson = await Bun.file(FIXTURE).text();
    const html = `<script id="__NEXT_DATA__" type="application/json">${nextDataJson}</script>`;

    const result = extractNextData(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.book.titleComplete).toBe("Dark Matter");
    expect(result.data.book.genres.length).toBeGreaterThan(0);
    expect(result.data.book.primaryAuthor.name).toBe("Blake Crouch");
    expect(result.data.work.averageRating).toBeGreaterThan(0);
    expect(result.data.work.ratingsCount).toBeGreaterThan(0);
  });

  test("HTML without __NEXT_DATA__ is a parse failure, not a dead book", () => {
    const html = "<html><body>No data here</body></html>";
    expect(extractNextData(html)).toEqual({ ok: false, failure: "next_data_parse_failed" });
  });

  test("unterminated or unparseable __NEXT_DATA__ does not throw", () => {
    const marker = `<script id="__NEXT_DATA__" type="application/json">`;
    expect(extractNextData(`${marker}{"props":`)).toEqual({
      ok: false,
      failure: "next_data_parse_failed",
    });
    expect(extractNextData(`${marker}not json</script>`)).toEqual({
      ok: false,
      failure: "next_data_parse_failed",
    });
  });
});

describe("parseGoodreadsData", () => {
  test("parses series information", async () => {
    const json = JSON.parse(await Bun.file(FIXTURE).text());
    const result = parseGoodreadsData(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.book.details.publisher).toBeDefined();
  });

  test("malformed input is a parse failure", () => {
    for (const input of [{}, { props: {} }, { props: { pageProps: {} } }]) {
      expect(parseGoodreadsData(input)).toEqual({
        ok: false,
        failure: "next_data_parse_failed",
      });
    }
  });

  // The distinction enrich_queue acts on: book_not_found_upstream tombstones a
  // book on its first attempt, next_data_parse_failed keeps retrying.
  describe("book gone vs. parser confused", () => {
    const withRootQuery = (rootQuery: Record<string, unknown>) => ({
      props: { pageProps: { apolloState: { ROOT_QUERY: rootQuery } } },
    });

    test("a resolved-to-null book query means Goodreads deleted the book", () => {
      // Verified against a real Goodreads response where the query resolves to
      // literally null.
      const json = withRootQuery({
        __typename: "Query",
        'getBookByLegacyId({"legacyId":"12701475"})': null,
      });
      expect(parseGoodreadsData(json)).toEqual({
        ok: false,
        failure: "book_not_found_upstream",
      });
    });

    test("a missing book query means our parser didn't understand the page", () => {
      expect(parseGoodreadsData(withRootQuery({ __typename: "Query" }))).toEqual({
        ok: false,
        failure: "next_data_parse_failed",
      });
    });

    test("a query resolving to a ref we can't follow is also our problem", () => {
      const json = withRootQuery({
        'getBookByLegacyId({"legacyId":"1"})': { __ref: "Book:missing" },
      });
      expect(parseGoodreadsData(json)).toEqual({
        ok: false,
        failure: "next_data_parse_failed",
      });
    });
  });
});
