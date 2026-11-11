import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { HeaderAction } from "@/components/HeaderAction";

import { BookCard } from "@/components/BookCard";
import { StarDisplay } from "@/components/StarDisplay";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { catalogueCoverUrl } from "@/utils/catalogueCover";
import { useColorScheme } from "@/hooks/useColorScheme";
import { displayAuthors } from "../../../src/core/authors";
import type { UserBook } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

/** Read-only public shelf preview. Tracked-book editing belongs to My Books. */
export function ProfileBookSection({
  books,
  title,
  accessibilityLabel,
  status,
  did,
}: {
  books: UserBook[];
  title: string;
  accessibilityLabel: string;
  status: "reading" | "wantToRead" | "finished";
  did: string;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  if (books.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderContent}>
          <ThemedText style={[styles.sectionTitle, { color: colors.primaryText }]} type="heading">
            {title}
          </ThemedText>
          <ThemedText type="caption" style={{ color: colors.secondaryText }}>
            {books.length} {books.length === 1 ? "book" : "books"}
          </ThemedText>
        </View>
        <HeaderAction
          title="See all"
          tone="neutral"
          accessibilityLabel={accessibilityLabel}
          onPress={() => router.push(`/books/${status}?did=${did}` as any)}
        />
      </View>
      <View style={styles.bookRows}>
        {books.slice(0, 3).map((book) => (
          <View key={book.hiveId}>
            <BookCard
              title={book.title}
              authors={displayAuthors(book.authors)}
              imageUri={catalogueCoverUrl(getBaseUrl(), book)}
              onPress={() => router.push(`/book/${book.hiveId}`)}
              variant="row"
              rowSize="compact"
            >
              {book.stars != null && book.stars > 0 && (
                <View style={styles.ratingContainer}>
                  <StarDisplay rating={book.stars} />
                  <ThemedText
                    style={[styles.ratingText, { color: colors.secondaryText }]}
                    type="caption"
                  >
                    {book.stars / 2}
                  </ThemedText>
                </View>
              )}
            </BookCard>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 0 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderContent: {
    gap: 2,
    flex: 1,
  },
  sectionTitle: { flex: 1 },
  bookRows: { gap: 8 },
  ratingContainer: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { lineHeight: 16 },
});
