import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { BookCoverGrid } from "@/components/BookCoverGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedButton } from "@/components/ThemedButton";
import { ThemedText } from "@/components/ThemedText";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import type { UserBook } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";
import { HeaderAction } from "@/components/HeaderAction";

const MAX_BOOKS_PER_SECTION = 4;
const STATUS_ROUTES = {
  [BOOK_STATUS.READING]: "reading",
  [BOOK_STATUS.WANTTOREAD]: "wantToRead",
  [BOOK_STATUS.FINISHED]: "finished",
  [BOOK_STATUS.ABANDONED]: "abandoned",
  owned: "owned",
} as const;

export function HomeBookSection({
  books,
  title,
  icon,
  emptyMessage,
  emptySubtitle,
  status,
}: {
  books: UserBook[];
  title: string;
  icon: ComponentProps<typeof SectionHeader>["icon"];
  emptyMessage: string;
  emptySubtitle: string;
  status: keyof typeof STATUS_ROUTES;
}) {
  const router = useRouter();
  const colors = Colors[useColorScheme() ?? "light"];
  const displayBooks = books.slice(0, MAX_BOOKS_PER_SECTION);

  if (books.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title={title} icon={icon} />
        {status === BOOK_STATUS.WANTTOREAD ? (
          <View style={styles.quietEmpty}>
            <ThemedText style={{ color: colors.secondaryText }}>{emptySubtitle}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Find a book to read next"
              onPress={() => router.navigate("/explore")}
              style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
            >
              <ThemedText style={{ color: colors.text, textDecorationLine: "underline" }}>
                Find a book
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.emptyContent, { borderLeftColor: colors.primary }]}>
            <ThemedText style={{ color: colors.primaryText }} type="body">
              {emptyMessage}
            </ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
              {emptySubtitle}
            </ThemedText>
            <ThemedButton
              title="Find a book"
              variant="primary"
              style={{ marginTop: 16, minHeight: 44, alignSelf: "flex-start" }}
              onPress={() => router.navigate("/explore")}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader
        icon={icon}
        title={title}
        subtitle={`${books.length} ${books.length === 1 ? "book" : "books"}`}
        right={
          <HeaderAction
            title="See all"
            tone="neutral"
            accessibilityLabel={`See all ${title.toLowerCase()} books, ${books.length} books`}
            onPress={() => router.push(`/books/${STATUS_ROUTES[status]}`)}
          />
        }
        style={{ marginBottom: 16 }}
      />
      <View style={styles.bookPadding}>
        <BookCoverGrid books={displayBooks} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  quietEmpty: { marginHorizontal: 20 },
  emptyContent: { marginHorizontal: 20, paddingLeft: 16, paddingVertical: 4, borderLeftWidth: 2 },
  emptySubtitle: { marginTop: 4, lineHeight: 24 },
  bookPadding: { paddingHorizontal: 20 },
});
