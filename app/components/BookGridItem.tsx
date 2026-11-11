import { BookCard } from "@/components/BookCard";
import { getBaseUrl } from "@/context/auth";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { catalogueCoverUrl } from "@/utils/catalogueCover";
import { UserBook } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

interface BookGridItemProps {
  book: UserBook;
  style?: StyleProp<ViewStyle>;
  status?: string;
  numColumns?: number;
}

export function BookGridItem({ book, style, status, numColumns = 2 }: BookGridItemProps) {
  const handlePress = () => {
    if (status) {
      // Navigate to book detail and pass context about where we came from
      router.push(`/book/${book.hiveId}?status=${status}`);
    } else {
      router.push(`/book/${book.hiveId}`);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          flex: numColumns > 1 ? 1 : undefined,
          marginHorizontal: numColumns > 1 ? 4 : 0,
        },
        style,
      ]}
    >
      <BookCard
        title={book.title}
        authors={book.authors}
        imageUri={catalogueCoverUrl(getBaseUrl(), book)}
        onPress={handlePress}
        variant="dense"
        style={styles.bookCard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  bookCard: {
    paddingBottom: 8,
  },
});
