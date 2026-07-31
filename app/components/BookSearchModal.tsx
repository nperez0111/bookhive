import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadeInImage } from "@/components/FadeInImage";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import type { HiveBook } from "../../src/types";

type BookSearchModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelectBook: (book: HiveBook) => void;
  /** Shown above the search field so the user knows what they're matching. */
  subjectTitle?: string;
  /** Prefills the query — usually the title we already know for the file. */
  initialQuery?: string;
  isLinking?: boolean;
};

/**
 * Book picker sheet. Deliberately searches the whole catalog rather than
 * honouring the preferred-language filter: the user is matching a file they
 * already own, and hiding the one right answer would be worse than noise.
 */
export function BookSearchModal({
  visible,
  onClose,
  onSelectBook,
  subjectTitle,
  initialQuery = "",
  isLinking = false,
}: BookSearchModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const { bottom } = useSafeAreaInsets();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    if (visible) setQuery(initialQuery);
  }, [visible, initialQuery]);

  // The sheet stays mounted so it can animate out, so gate the search on
  // `visible` — otherwise a closed picker keeps refetching the last query.
  const { data: results, isLoading, error } = useSearchBooks(visible ? query : "");
  const books = results ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.cardBorder,
              paddingBottom: bottom,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.cardBorder }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="heading" style={{ color: colors.primaryText }}>
                Link to a BookHive book
              </ThemedText>
              {subjectTitle ? (
                <ThemedText
                  type="caption"
                  style={{ color: colors.secondaryText, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {subjectTitle}
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText type="label" style={{ color: colors.primary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>

          <View
            style={[
              styles.searchField,
              {
                borderColor: colors.cardBorder,
                backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#fafafa",
              },
            ]}
          >
            <Ionicons name="search" size={18} color={colors.tertiaryText} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by title or author"
              placeholderTextColor={colors.tertiaryText}
              style={[styles.searchInput, { color: colors.primaryText }]}
              autoFocus={!initialQuery}
              autoCorrect={false}
              returnKeyType="search"
              selectTextOnFocus
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.tertiaryText} />
              </Pressable>
            ) : null}
          </View>

          {!query ? (
            <View style={styles.hint}>
              <Ionicons name="library-outline" size={32} color={colors.tertiaryText} />
              <ThemedText type="caption" style={[styles.hintText, { color: colors.secondaryText }]}>
                Search BookHive to link this file, so your reading progress lands on the right book.
              </ThemedText>
            </View>
          ) : isLoading ? (
            <View style={styles.hint}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.hint}>
              <ThemedText type="caption" style={[styles.hintText, { color: colors.secondaryText }]}>
                Couldn&apos;t search right now. Check your connection and try again.
              </ThemedText>
            </View>
          ) : books.length === 0 ? (
            <View style={styles.hint}>
              <ThemedText type="caption" style={[styles.hintText, { color: colors.secondaryText }]}>
                No matches for “{query}”. Try the author&apos;s name, or a shorter title.
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={books}
              keyExtractor={(book) => book.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.results}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onSelectBook(item)}
                  disabled={isLinking}
                  style={({ pressed }) => [
                    styles.result,
                    { backgroundColor: pressed ? colors.activeBackground : "transparent" },
                  ]}
                >
                  <FadeInImage
                    source={{
                      uri: `${getBaseUrl()}/images/s_120x180,fit_cover/${item.cover || item.thumbnail}`,
                    }}
                    style={[styles.resultCover, { backgroundColor: colors.inactiveBackground }]}
                    resizeMode="cover"
                  />
                  <View style={styles.resultText}>
                    <ThemedText
                      type="label"
                      style={{ color: colors.primaryText }}
                      numberOfLines={2}
                    >
                      {item.title}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: colors.secondaryText }}
                      numberOfLines={1}
                    >
                      {item.authors?.split("\t").join(", ")}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.tertiaryText} />
                </Pressable>
              )}
            />
          )}

          {isLinking ? (
            <View style={[styles.linkingOverlay, { backgroundColor: colors.cardBackground }]}>
              <ActivityIndicator color={colors.primary} />
              <ThemedText type="label" style={{ color: colors.secondaryText }}>
                Linking…
              </ThemedText>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  sheet: {
    height: "82%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  hintText: {
    textAlign: "center",
    lineHeight: 18,
  },
  results: {
    paddingVertical: 12,
    gap: 4,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderRadius: 12,
  },
  resultCover: {
    width: 40,
    height: 60,
    borderRadius: 6,
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  linkingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    opacity: 0.94,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
