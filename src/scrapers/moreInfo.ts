import { fetchGoodreadsViaWaf } from "./waf/solver";
import { NEXT_DATA_MARKER } from "./waf/pageMarker";

// TypeScript interfaces for Goodreads data structure
interface ParsedGoodreadsData {
  book: {
    id: string;
    titleComplete: string;
    description: string;
    imageUrl: string;
    webUrl: string;
    genres: string[];
    series?: {
      title: string;
      position: string;
      webUrl: string;
    };
    details: {
      publicationYear: number;
      publisher: string;
      language: string;
      isbn?: string;
      isbn13?: string;
      numPages?: number;
    };
    primaryAuthor: {
      id: string;
      name: string;
      description: string;
      profileImageUrl: string;
    };
    secondaryContributors: Array<{
      name: string;
      // only authors please
      role: string;
    }>;
  };
  work: {
    averageRating: number;
    ratingsCount: number;
    ratingsDistribution: number[];
  };
}

const startString = NEXT_DATA_MARKER;

/**
 * Why a page we successfully fetched didn't yield a book.
 *
 * The split matters because the two get opposite treatment in `enrich_queue`:
 * `book_not_found_upstream` is definitive and tombstones the book on the first
 * attempt, while `next_data_parse_failed` means *our* parser didn't understand
 * the page and must keep retrying — otherwise a Goodreads redesign would write
 * off the entire catalogue in a few days.
 */
export type ParseFailure = "book_not_found_upstream" | "next_data_parse_failed";

export type ParseResult =
  | { ok: true; data: ParsedGoodreadsData }
  | { ok: false; failure: ParseFailure };

const parseFailed = (failure: ParseFailure): ParseResult => ({ ok: false, failure });

function parseGoodreadsData(json: any): ParseResult {
  try {
    const apolloState = json.props?.pageProps?.apolloState;
    if (!apolloState?.ROOT_QUERY) return parseFailed("next_data_parse_failed");

    // Find the book reference
    const bookQuery = Object.keys(apolloState.ROOT_QUERY).find((key) =>
      key.startsWith("getBookByLegacyId"),
    );
    if (!bookQuery) return parseFailed("next_data_parse_failed");

    // The query resolved, to nothing. Goodreads served a real page and told us
    // this legacy id has no book behind it any more — deleted, or merged into
    // another edition. Verified live against /book/show/12701475, whose
    // `getBookByLegacyId({"legacyId":"12701475"})` is literally `null`.
    const bookRef = apolloState.ROOT_QUERY[bookQuery];
    if (bookRef === null) return parseFailed("book_not_found_upstream");

    const bookId = bookRef?.__ref;
    if (!bookId) return parseFailed("next_data_parse_failed");

    const bookData = apolloState[bookId];
    if (!bookData) return parseFailed("next_data_parse_failed");

    // Extract work data
    const workRef = bookData.work?.__ref;
    const workData = workRef ? apolloState[workRef] : null;

    // Extract primary author data
    const authorRef = bookData.primaryContributorEdge?.node?.__ref;
    const authorData = authorRef ? apolloState[authorRef] : null;

    // Extract series data
    const seriesRef = bookData.bookSeries?.[0]?.series?.__ref;
    const seriesData = seriesRef ? apolloState[seriesRef] : null;

    // Parse genres
    const genres = bookData.bookGenres?.map((bg: any) => bg.genre?.name).filter(Boolean) || [];

    // Parse secondary contributors (only authors)
    const secondaryContributors =
      bookData.secondaryContributorEdges
        ?.filter((edge: any) => edge.role === "Author")
        ?.map((edge: any) => ({
          name: apolloState[edge.node.__ref]?.name || "",
          role: edge.role || "",
        })) || [];

    // Parse ratings distribution
    const ratingsDistribution = workData?.stats?.ratingsCountDist || [];

    const data: ParsedGoodreadsData = {
      book: {
        id: bookData.id || "",
        titleComplete: bookData.titleComplete || "",
        description: bookData.description || "",
        imageUrl: bookData.imageUrl || "",
        webUrl: bookData.webUrl || "",
        genres,
        series: seriesData
          ? {
              title: seriesData.title || "",
              position: bookData.bookSeries?.[0]?.userPosition || "",
              webUrl: seriesData.webUrl || "",
            }
          : undefined,
        details: {
          publicationYear: bookData.details?.publicationTime
            ? new Date(bookData.details.publicationTime).getFullYear()
            : 0,
          publisher: bookData.details?.publisher || "",
          language: bookData.details?.language?.name || "",
          isbn: bookData.details?.isbn || undefined,
          isbn13: bookData.details?.isbn13 || undefined,
          numPages: bookData.details?.numPages || undefined,
        },
        primaryAuthor: {
          id: authorData?.id || "",
          name: authorData?.name || "",
          description: authorData?.description || "",
          profileImageUrl: authorData?.profileImageUrl || "",
        },
        secondaryContributors,
      },
      work: {
        averageRating: workData?.stats?.averageRating || 0,
        ratingsCount: workData?.stats?.ratingsCount || 0,
        ratingsDistribution,
      },
    };
    return { ok: true, data };
  } catch (error) {
    console.error("Error parsing Goodreads data:", error);
    return parseFailed("next_data_parse_failed");
  }
}

function extractNextData(html: string): ParseResult {
  const startIdx = html.indexOf(startString);
  if (startIdx === -1) return parseFailed("next_data_parse_failed");
  const nextData = html.slice(startIdx + startString.length);
  const endIdx = nextData.indexOf("</script>");
  if (endIdx === -1) return parseFailed("next_data_parse_failed");
  let json: unknown;
  try {
    json = JSON.parse(nextData.slice(0, endIdx));
  } catch {
    return parseFailed("next_data_parse_failed");
  }
  return parseGoodreadsData(json);
}

async function getBookDetailedInfo(
  sourceUrl: string,
  addWideEventContext?: (context: Record<string, unknown>) => void,
): Promise<ParsedGoodreadsData | null> {
  const addCtx = addWideEventContext ?? (() => {});
  try {
    // Fetches the page on this thread, handing a WAF challenge off to the solver
    // worker only if one actually comes back. See scrapers/waf/solver.ts.
    const html = await fetchGoodreadsViaWaf(sourceUrl, addCtx);
    if (!html) return null;

    const result = extractNextData(html);
    if (result.ok) return result.data;

    // Only the parser can conclude a book is gone, because only it can see that
    // `getBookByLegacyId` resolved to null. Everything else defers.
    addCtx({
      scrape_failure: result.failure,
      enrich_retry: result.failure === "book_not_found_upstream" ? "dead" : "defer",
    });
    return null;
  } catch (error) {
    addCtx({
      scrape_failure: "exception",
      scrape_error: error instanceof Error ? error.message : String(error),
      scrape_url: sourceUrl,
      enrich_retry: "defer",
    });
    return null;
  }
}

export { getBookDetailedInfo, extractNextData, parseGoodreadsData, type ParsedGoodreadsData };
