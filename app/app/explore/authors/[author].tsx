import { useLocalSearchParams } from "expo-router";
import { DiscoveryBooksScreen } from "@/components/DiscoveryBooksScreen";
import { useLanguage } from "@/context/language";
import { useAuthorBooks } from "@/hooks/useBookhiveQuery";
import { uniqueBooks } from "@/utils/discoveryPagination";

export default function AuthorBooksScreen() {
  const { author = "" } = useLocalSearchParams<{ author: string }>();
  const { preferredLanguage } = useLanguage();
  const query = useAuthorBooks(author, preferredLanguage);
  return (
    <DiscoveryBooksScreen
      title={author}
      countLabel={`${query.data?.pages[0]?.totalBooks ?? 0} books`}
      resetKey={`${author}:${preferredLanguage ?? ""}`}
      books={uniqueBooks(query.data?.pages ?? [])}
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
