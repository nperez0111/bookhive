import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { BookCard } from "./BookCard";
import { getBaseUrl } from "@/context/auth";
import { catalogueCoverUrl } from "@/utils/catalogueCover";
import { displayAuthors } from "../../src/core/authors";
import type { UserBook } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

/** Read-only covers, sized against the actual lane rather than the device width. */
export function BookCoverGrid({ books }: { books: UserBook[] }) {
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const columns = Math.max(2, Math.floor((width + 12) / 124));
  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}
    >
      {books.map((book) => (
        <View
          key={book.hiveId}
          style={{ width: width ? (width - (columns - 1) * 12) / columns : "30%" }}
        >
          <BookCard
            title={book.title}
            authors={displayAuthors(book.authors)}
            imageUri={catalogueCoverUrl(getBaseUrl(), book)}
            variant="list"
            onPress={() => router.push(`/book/${book.hiveId}`)}
          />
        </View>
      ))}
    </View>
  );
}
