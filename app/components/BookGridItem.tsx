import { BookCard } from "@/components/BookCard";
import { getBaseUrl } from "@/context/auth";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";
import { UserBook } from "../../src/bsky/lexicon/types/buzz/bookhive/defs";

interface BookGridItemProps {
  book: UserBook;
  style?: any;
  status?: string;
  numColumns?: number;
}

export function BookGridItem({
  book,
  style,
  status,
  numColumns = 2,
}: BookGridItemProps) {
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
        imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
        onPress={handlePress}
        orientation="horizontal"
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
    alignItems: "center",
  },
});
