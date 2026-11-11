import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BookCard } from "@/components/BookCard";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedButton } from "@/components/ThemedButton";
import { ThemedText } from "@/components/ThemedText";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { catalogueCoverUrl } from "@/utils/catalogueCover";
import { useColorScheme } from "@/hooks/useColorScheme";
import { displayAuthors } from "@/utils/trackedBooks";
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

function HomeBookRows({ books }: { books: UserBook[] }) {
  return (
    <View style={styles.bookRows}>
      {books.map((book, index) => (
        <View key={book.hiveId} style={styles.readingItem}>
          <AnimatedListItem index={index}>
            <BookCard
              title={book.title}
              authors={displayAuthors(book.authors) || "Unknown author"}
              imageUri={catalogueCoverUrl(getBaseUrl(), book)}
              onPress={() => router.push(`/book/${book.hiveId}`)}
              variant="row"
              rowSize="small"
              meta={
                book.status === BOOK_STATUS.READING
                  ? "Update progress"
                  : book.finishedAt
                    ? `Finished ${book.finishedAt.slice(0, 10)}`
                    : undefined
              }
            />
          </AnimatedListItem>
        </View>
      ))}
    </View>
  );
}

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
              onPress={() => router.push("/search")}
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
              onPress={() => router.push("/search")}
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
        <HomeBookRows books={displayBooks} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  quietEmpty: { marginHorizontal: 20 },
  emptyContent: { marginHorizontal: 20, paddingLeft: 16, paddingVertical: 4, borderLeftWidth: 2 },
  emptySubtitle: { marginTop: 4, lineHeight: 24 },
  bookRows: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  readingItem: { width: "100%" },
  bookPadding: { paddingHorizontal: 20 },
});
