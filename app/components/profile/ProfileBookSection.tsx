import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { HeaderAction } from "@/components/HeaderAction";

import { BookCoverGrid } from "@/components/BookCoverGrid";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
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
  const router = useRouter();
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
      <BookCoverGrid books={books.slice(0, 3)} />
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
});
