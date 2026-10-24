import { Pressable } from "react-native";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";

type Props = {
  error: Error | null;
  isFetchNextPageError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
  loadMoreLabel?: string;
  loadingLabel?: string;
};

/** Presentation only; callers retain pages, query keys and visibility guards. */
export function InfinitePaginationFooter({
  error,
  isFetchNextPageError,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  refetch,
  loadMoreLabel = "Load more",
  loadingLabel = "Loading…",
}: Props) {
  const color = useThemeColor({}, "primary");
  if (error) {
    return (
      <QueryErrorHandler
        error={error}
        onRetry={() => (isFetchNextPageError ? fetchNextPage() : refetch())}
        showRetryButton
        showGoBackButton={false}
      />
    );
  }
  if (!hasNextPage) return null;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isFetching || isFetchingNextPage}
      onPress={() => {
        if (!isFetching && !isFetchingNextPage) void fetchNextPage();
      }}
      style={{ minHeight: 44, padding: 16, alignItems: "center", justifyContent: "center" }}
    >
      <ThemedText type="label" style={{ color }}>
        {isFetchingNextPage ? loadingLabel : loadMoreLabel}
      </ThemedText>
    </Pressable>
  );
}
