import { getWafToken, invalidateWafToken, WAF_USER_AGENT } from "./waf/solver";

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

const startString = `__NEXT_DATA__" type="application/json">`;

function parseGoodreadsData(json: any): ParsedGoodreadsData | null {
  try {
    const apolloState = json.props?.pageProps?.apolloState;
    if (!apolloState) return null;

    // Find the book reference
    const bookQuery = Object.keys(apolloState.ROOT_QUERY).find((key) =>
      key.startsWith("getBookByLegacyId"),
    );
    if (!bookQuery) return null;

    const bookRef = apolloState.ROOT_QUERY[bookQuery];
    const bookId = bookRef?.__ref;
    if (!bookId) return null;

    const bookData = apolloState[bookId];
    if (!bookData) return null;

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

    return {
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
  } catch (error) {
    console.error("Error parsing Goodreads data:", error);
    return null;
  }
}

function extractNextData(html: string): ParsedGoodreadsData | null {
  const startIdx = html.indexOf(startString);
  if (startIdx === -1) return null;
  const nextData = html.slice(startIdx + startString.length);
  const endIdx = nextData.indexOf("</script>");
  if (endIdx === -1) return null;
  const json = JSON.parse(nextData.slice(0, endIdx));
  return parseGoodreadsData(json);
}

async function fetchGoodreadsPage(
  sourceUrl: string,
  addCtx: (context: Record<string, unknown>) => void,
): Promise<string | null> {
  const doFetch = async (cookie?: string) => {
    const headers: Record<string, string> = {
      "User-Agent": WAF_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (cookie) headers["Cookie"] = `aws-waf-token=${cookie}`;
    return fetch(sourceUrl, { signal: AbortSignal.timeout(15_000), headers });
  };

  // Fast path: try without token (WAF may not be active)
  const firstResp = await doFetch();
  addCtx({ scrape_status: firstResp.status, scrape_url: sourceUrl });

  if (firstResp.ok || firstResp.status !== 202) {
    const html = await firstResp.text();
    if (html.includes(startString)) {
      addCtx({ scrape_method: "plain_http" });
      return html;
    }
  }

  // WAF is active — get a token
  addCtx({ scrape_method: "waf_solver" });
  const token = await getWafToken(sourceUrl);
  if (!token) {
    addCtx({ scrape_failure: "waf_solve_failed" });
    return null;
  }

  const tokenResp = await doFetch(token);
  addCtx({ scrape_status_with_token: tokenResp.status });

  const html = await tokenResp.text();
  if (html.includes(startString)) return html;

  // Token didn't work — invalidate and try solving fresh
  invalidateWafToken();
  addCtx({ scrape_failure: "token_rejected_retrying" });

  const freshToken = await getWafToken(sourceUrl);
  if (!freshToken) {
    addCtx({ scrape_failure: "waf_solve_retry_failed" });
    return null;
  }

  const retryResp = await doFetch(freshToken);
  const retryHtml = await retryResp.text();
  if (retryHtml.includes(startString)) return retryHtml;

  addCtx({ scrape_failure: "waf_token_ineffective" });
  return null;
}

async function getBookDetailedInfo(
  sourceUrl: string,
  addWideEventContext?: (context: Record<string, unknown>) => void,
): Promise<ParsedGoodreadsData | null> {
  const addCtx = addWideEventContext ?? (() => {});
  try {
    const html = await fetchGoodreadsPage(sourceUrl, addCtx);
    if (!html) return null;
    const result = extractNextData(html);
    if (!result) addCtx({ scrape_failure: "next_data_parse_failed" });
    return result;
  } catch (error) {
    addCtx({
      scrape_failure: "exception",
      scrape_error: error instanceof Error ? error.message : String(error),
      scrape_url: sourceUrl,
    });
    return null;
  }
}

export { getBookDetailedInfo, extractNextData, parseGoodreadsData, type ParsedGoodreadsData };
