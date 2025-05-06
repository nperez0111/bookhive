import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useProfile, useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useThemeColor } from "@/hooks/useThemeColor";
import { router } from "expo-router";
import { useState } from "react";
import { getBaseUrl } from "@/context/auth";
import type { HiveBook } from "../../../src/types";
import { BOOK_STATUS } from "@/constants";

export default function SearchScreen() {
  const [query, setQuery] = useState("");

  const profile = useProfile();
  const { data: searchResults, isLoading, error } = useSearchBooks(query);
  const placeholderColor = useThemeColor(
    { light: "#A0A0A0", dark: "#A0A0A0" },
    "text",
  );
  const cardBackgroundColor = useThemeColor(
    { light: "#F8F8F8", dark: "#1A1A1A" },
    "background",
  );

  const renderSearchResultItem = ({ item: book }: { item: HiveBook }) => (
    <Pressable
      onPress={() => router.push(`/book/${book.id}`)}
      style={styles.searchResultItem}
    >
      <Image
        src={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
        style={styles.searchResultCover}
      />
      <View style={styles.searchResultInfo}>
        <ThemedText type="subtitle">{book.title}</ThemedText>
        <ThemedText type="default" style={{ opacity: 0.8 }}>
          {book.authors}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={styles.screenContainer}>
      <FlatList
        ListHeaderComponent={
          <>
            <View style={styles.headerContainer}>
              <ThemedText type="title" style={styles.headerTitle}>
                Discover Books
              </ThemedText>
            </View>

            <View style={styles.searchContainer}>
              <Ionicons
                name="search"
                size={20}
                color={placeholderColor}
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchBox}
                placeholder="Search..."
                placeholderTextColor={placeholderColor}
                value={query}
                onChangeText={setQuery}
                autoComplete="off"
                clearButtonMode="while-editing"
                autoCapitalize="none"
              />
            </View>

            {!searchResults?.length && profile.data && (
              <View style={styles.currentlyReadingSection}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Currently Reading
                </ThemedText>
                <FlatList
                  data={profile.data.books.filter(
                    (book) => book.status === BOOK_STATUS.READING,
                  )}
                  renderItem={({ item: book }) => (
                    <Pressable
                      onPress={() => router.push(`/book/${book.hiveId}`)}
                      style={styles.currentlyReadingCard}
                    >
                      <Image
                        source={{
                          uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
                        }}
                        style={styles.currentlyReadingCover}
                        resizeMode="cover"
                      />
                      <ThemedText
                        style={styles.currentlyReadingTitle}
                        numberOfLines={1}
                      >
                        {book.title}
                      </ThemedText>
                      <ThemedText
                        style={styles.currentlyReadingAuthor}
                        numberOfLines={1}
                      >
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
            )}

            {isLoading && (
              <ActivityIndicator
                size="large"
                color="#007AFF"
                style={{ marginTop: 20 }}
              />
            )}
            {error && (
              <ThemedText style={styles.errorText}>
                Error: {error.message}
              </ThemedText>
            )}

            {searchResults && searchResults.length > 0 && !isLoading && (
              <ThemedText type="subtitle" style={styles.searchResultsTitle}>
                Search Results
              </ThemedText>
            )}
          </>
        }
        data={searchResults || []}
        keyExtractor={(item) => item.id}
        renderItem={renderSearchResultItem}
        contentContainerStyle={styles.searchResultsList}
        ListEmptyComponent={() =>
          !isLoading && query.length > 0 && !error ? (
            <ThemedText style={styles.noResultsText}>
              No books found for "{query}"
            </ThemedText>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 10,
  },
  headerTitle: {},
  profileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2E",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 15,
    marginBottom: 25,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchBox: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: "#FFFFFF",
  },
  filterIconContainer: {
    paddingLeft: 10,
  },
  currentlyReadingSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    marginLeft: 16,
  },
  horizontalListContent: {
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  currentlyReadingCard: {
    backgroundColor: "#2C2C2E",
    borderRadius: 12,
    padding: 10,
    marginRight: 12,
    width: 140,
    alignItems: "center",
  },
  currentlyReadingCover: {
    width: 100,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: "#444",
  },
  currentlyReadingTitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
  },
  currentlyReadingAuthor: {
    fontSize: 12,
    opacity: 0.7,
    textAlign: "center",
    marginTop: 2,
  },
  searchResultsList: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  searchResultsTitle: {
    marginTop: 10,
    marginBottom: 15,
    fontSize: 18,
    fontWeight: "600",
  },
  searchResultItem: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#3A3A3C",
    gap: 12,
  },
  searchResultCover: {
    width: 60,
    height: 90,
    borderRadius: 4,
  },
  searchResultInfo: {
    flex: 1,
    justifyContent: "center",
  },
  errorText: {
    color: "red",
    textAlign: "center",
    marginTop: 20,
    marginHorizontal: 16,
  },
  noResultsText: {
    textAlign: "center",
    marginTop: 40,
    opacity: 0.7,
  },
});
