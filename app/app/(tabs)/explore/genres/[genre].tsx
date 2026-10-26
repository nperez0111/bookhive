import { useLocalSearchParams } from "expo-router";
import { DiscoveryBooksScreen } from "@/components/DiscoveryBooksScreen";
import { useLanguage } from "@/context/language";
import { useGenreBooks } from "@/hooks/useBookhiveQuery";
import { uniqueBooks } from "@/utils/discoveryPagination";

export default function GenreBooksScreen() {
  const { genre = "" } = useLocalSearchParams<{ genre: string }>();
  const { preferredLanguage } = useLanguage();
  const query = useGenreBooks(genre, preferredLanguage);
  const books = uniqueBooks(query.data?.pages ?? []);
  return (
    <DiscoveryBooksScreen
      title={genre}
      countLabel={`${books.length}${query.hasNextPage ? "+" : ""} books`}
      resetKey={`${genre}:${preferredLanguage ?? ""}`}
      books={books}
      hasData={Boolean(query.data)}
      isLoading={query.isLoading}
      error={query.error}
      hasNextPage={query.hasNextPage}
      isFetching={query.isFetching}
      isFetchingNextPage={query.isFetchingNextPage}
      isFetchNextPageError={query.isFetchNextPageError}
      refetch={query.refetch}
      fetchNextPage={query.fetchNextPage}
    />
  );
}
