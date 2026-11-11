import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { ActionSheet } from "@/components/ActionSheet";
import { BookCard } from "@/components/BookCard";
import { StarDisplay } from "@/components/StarDisplay";
import { ThemedText } from "@/components/ThemedText";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useUpdateBook } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { displayAuthors, trackedStatusLabel } from "@/utils/trackedBooks";
import { isHiveId } from "../../../src/core/hiveId";
import { starsToDisplayRating } from "../../../src/core/rating";
import type { UserBook } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

export function TrackedBookItem({
  book,
  grid,
  onError,
}: {
  book: UserBook;
  grid: boolean;
  onError: (message: string | null) => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  const update = useUpdateBook();
  const [statusOpen, setStatusOpen] = useState(false);
  const image = book.cover || book.thumbnail;
  const save = async (patch: { status: string }) => {
    if (!isHiveId(book.hiveId)) {
      onError("This book has an invalid identifier. Refresh your books and try again.");
      return;
    }
    onError(null);
    try {
      await update.mutateAsync({ hiveId: book.hiveId, ...patch });
    } catch (error) {
      // A status-filtered row can disappear before its save completes.
      onError(
        `Could not update “${book.title}”: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    }
  };
  const statusLabel =
    book.status === BOOK_STATUS.FINISHED ? "Read" : trackedStatusLabel(book.status);
  const progress = book.status === BOOK_STATUS.READING ? book.bookProgress : undefined;
  const progressLabel =
    progress?.currentPage != null
      ? `${progress.currentPage}${progress.totalPages ? ` of ${progress.totalPages}` : ""} pages`
      : progress?.percent != null
        ? `${progress.percent}% complete`
        : undefined;
  return (
    <View
      style={[
        styles.card,
        grid ? styles.gridCard : styles.listCard,
        { borderColor: colors.cardBorder },
      ]}
    >
      <BookCard
        title={book.title || "Untitled book"}
        authors={displayAuthors(book.authors) || "Unknown author"}
        imageUri={image ? `${getBaseUrl()}/images/s_300x450,fit_cover/${image}` : ""}
        onPress={() => router.push(`/book/${book.hiveId}`)}
        variant={grid ? "dense" : "row"}
        rowSize="small"
        style={grid ? undefined : { flex: 1 }}
        meta={progressLabel}
      >
        {book.stars != null && book.stars > 0 && (
          <View style={styles.rating}>
            <StarDisplay rating={book.stars} />
            <ThemedText type="caption" style={styles.number}>
              {starsToDisplayRating(book.stars)}
            </ThemedText>
          </View>
        )}
      </BookCard>
      <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change reading status for ${book.title}`}
          accessibilityState={{
            disabled: update.isPending,
            busy: update.isPending,
            expanded: statusOpen,
          }}
          disabled={update.isPending}
          onPress={() => setStatusOpen(true)}
          style={{
            minHeight: 44,
            paddingHorizontal: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          {update.isPending ? (
            <ActivityIndicator size="small" color={colors.accentForeground} />
          ) : (
            <ThemedText type="label" style={{ color: colors.accentForeground, flexShrink: 1 }}>
              {book.status ? statusLabel : "Set status"}
            </ThemedText>
          )}
          <Ionicons name="chevron-down" size={14} color={colors.accentForeground} />
        </Pressable>
      </View>
      <ActionSheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Reading status"
        actions={[
          ...[
            BOOK_STATUS.WANTTOREAD,
            BOOK_STATUS.READING,
            BOOK_STATUS.FINISHED,
            BOOK_STATUS.ABANDONED,
          ].map((status) => ({
            key: status,
            icon: "book-outline" as const,
            label: status === BOOK_STATUS.FINISHED ? "Read" : trackedStatusLabel(status),
            selected: book.status === status,
            disabled: update.isPending,
            onPress: () => {
              setStatusOpen(false);
              void save({ status });
            },
          })),
          {
            key: "clear",
            icon: "remove-circle-outline",
            label: "No status",
            selected: !book.status,
            disabled: update.isPending,
            onPress: () => {
              setStatusOpen(false);
              void save({ status: "" });
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderBottomWidth: StyleSheet.hairlineWidth },
  listCard: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8 },
  gridCard: { width: "48%", flexShrink: 1, paddingVertical: 10 },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  number: { fontVariant: ["tabular-nums"] },
});
