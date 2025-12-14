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
    const genres =
      bookData.bookGenres?.map((bg: any) => bg.genre?.name).filter(Boolean) ||
      [];

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

async function getBookDetailedInfo(
  sourceUrl: string,
): Promise<ParsedGoodreadsData | null> {
  try {
    const response = await fetch(sourceUrl);
    const data = await response.text();
    const nextData = data.slice(data.indexOf(startString) + startString.length);
    const json = JSON.parse(nextData.slice(0, nextData.indexOf("</script>")));
    return parseGoodreadsData(json);
  } catch (error) {
    console.error("Error fetching or parsing Goodreads data:", error);
    return null;
  }
}

export { getBookDetailedInfo, type ParsedGoodreadsData };
