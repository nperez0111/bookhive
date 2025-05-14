import {
  ActivityIndicator,
  Button,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  RefreshControl,
} from "react-native";

import { HelloWave } from "@/components/HelloWave";
import { ThemedText } from "@/components/ThemedText";
import { getBaseUrl } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { router } from "expo-router";
import { useState, useCallback } from "react";
import { BOOK_STATUS } from "@/constants";
import { UserBook } from "../../../src/bsky/lexicon/types/buzz/bookhive/defs";

function BookSection({ books, title }: { books: UserBook[]; title: string }) {
  if (books.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <FlatList
        data={books}
        renderItem={({ item: book }) => (
          <Pressable
            onPress={() => router.push(`/book/${book.hiveId}`)}
            style={styles.bookCard}
          >
            <Image
              source={{
                uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
              }}
              style={styles.bookCover}
              resizeMode="cover"
            />
            <ThemedText style={styles.bookTitle} numberOfLines={1}>
              {book.title}
            </ThemedText>
            <ThemedText style={styles.bookAuthor} numberOfLines={1}>
              {book.authors}
            </ThemedText>
          </Pressable>
        )}
        keyExtractor={(item) => item.hiveId}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalListContent}
      />
    </View>
  );
}

export default function HomeScreen() {
  const profile = useProfile();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    profile.refetch().finally(() => setIsRefreshing(false));
  }, [profile.refetch]);

  if (profile.isLoading && !isRefreshing && !profile.data) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  if (profile.error) {
    return <ThemedText>Error: {profile.error.message}</ThemedText>;
  }

  if (!profile.data) {
    return <ThemedText>No profile data found.</ThemedText>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.welcomeContainer}>
        <ThemedText type="subtitle">
          Welcome, {profile.data.profile.displayName}!
        </ThemedText>
        <HelloWave />
      </View>
      <BookSection
        books={profile.data.books.filter(
          (book) => book.status === BOOK_STATUS.READING,
        )}
        title="Reading"
      />
      <BookSection
        books={profile.data.books.filter(
          (book) => book.status === BOOK_STATUS.WANTTOREAD,
        )}
        title="Want to Read"
      />
      <BookSection
        books={profile.data.books.filter(
          (book) => book.status === BOOK_STATUS.FINISHED,
        )}
        title="Read"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
    marginLeft: 16,
  },
  horizontalListContent: {
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  bookCard: {
    backgroundColor: "#2C2C2E",
    borderRadius: 12,
    padding: 10,
    marginRight: 12,
    width: 140,
    alignItems: "center",
  },
  bookCover: {
    width: 100,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: "#444",
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
  },
  bookAuthor: {
    fontSize: 12,
    opacity: 0.7,
    textAlign: "center",
    marginTop: 2,
  },
  welcomeContainer: {
    marginTop: 16,
    marginBottom: 16,
    display: "flex",
    flexDirection: "row",
    gap: 8,
  },
});
