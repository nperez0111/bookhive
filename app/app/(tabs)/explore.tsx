import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";

import { AuthorBrowser } from "@/components/discovery/AuthorBrowser";
import { GenreBrowser } from "@/components/discovery/GenreBrowser";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HeaderAction } from "@/components/HeaderAction";
import { LanguagePicker } from "@/components/LanguagePicker";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useLanguage } from "@/context/language";
import { useExplore, useLanguages } from "@/hooks/useBookhiveQuery";
import { useAuthorDirectory } from "@/hooks/useAuthorDirectory";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

export default function ExploreScreen() {
  const top = useScreenTopInset();
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: top }}>
        <ScreenHeader
          title="Discover"
          actions={
            <HeaderAction
              title="Community"
              tone="neutral"
              accessibilityLabel="Community feed"
              onPress={() => router.push("/feed")}
            />
          }
        />
        <View style={{ paddingHorizontal: 20 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search books"
            onPress={() => router.push("/search")}
            style={[
              styles.searchEntry,
              { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
            ]}
          >
            <Ionicons name="search-outline" size={20} color={colors.secondaryText} />
            <ThemedText style={{ color: colors.secondaryText }}>Title, author or ISBN</ThemedText>
          </Pressable>
        </View>
      </View>
      <ExploreContent />
    </View>
  );
}

function ExploreContent() {
  const colors = Colors[useColorScheme() ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { preferredLanguage, setPreferredLanguage } = useLanguage();
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [showAuthorDirectory, setShowAuthorDirectory] = useState(false);
  const [browse, setBrowse] = useState<"genres" | "authors">("genres");
  const explore = useExplore(preferredLanguage, browse === "genres" && showAllGenres);
  const languages = useLanguages();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");
  const authorDirectory = useAuthorDirectory(
    authorQuery,
    preferredLanguage,
    browse === "authors" && showAuthorDirectory,
  );

  const showingFeatured = browse === "genres" ? !showAllGenres : !showAuthorDirectory;
  const directory = explore.genreDirectory;
  const genres = showAllGenres
    ? (directory.data?.pages.flatMap((page) => page.genres) ?? [])
    : (explore.data?.genres ?? []).slice(0, 6);
  const authors = showAuthorDirectory
    ? authorDirectory.authors
    : (explore.data?.topAuthors ?? []).slice(0, 5);

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <LanguagePicker
        visible={languageOpen}
        languages={languages.data ?? []}
        selected={preferredLanguage}
        onSelect={setPreferredLanguage}
        onClose={() => setLanguageOpen(false)}
        loading={languages.isFetching}
        failed={languages.isError}
        onRetry={() => void languages.refetch()}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View
          accessibilityRole="tablist"
          style={[styles.browseSwitch, { backgroundColor: colors.cardBackground }]}
        >
          {(["genres", "authors"] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: browse === key }}
              onPress={() => setBrowse(key)}
              style={[
                styles.browseTab,
                browse === key && { backgroundColor: colors.activeBackground },
              ]}
            >
              <ThemedText
                type="label"
                style={{
                  color: browse === key ? colors.primaryText : colors.secondaryText,
                  fontWeight: browse === key ? "600" : "500",
                }}
              >
                {key === "genres" ? "Genres" : "Authors"}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change discovery language"
          accessibilityState={{ expanded: languageOpen }}
          accessibilityValue={{ text: preferredLanguage || "All languages" }}
          onPress={() => {
            setLanguageOpen(true);
            void languages.refetch();
          }}
          style={styles.languageButton}
        >
          <Ionicons name="globe-outline" size={16} color={colors.secondaryText} />
          <ThemedText type="caption" style={{ color: colors.secondaryText }}>
            {preferredLanguage || "All languages"}
          </ThemedText>
          <Ionicons
            name={languageOpen ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.secondaryText}
          />
        </Pressable>
        <ThemedText style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}>
          Book results use your selected language.
        </ThemedText>
        {showingFeatured && explore.isLoading && <ActivityIndicator color={colors.primary} />}
        {showingFeatured && explore.error && (
          <QueryErrorHandler
            error={explore.error}
            onRetry={() => explore.refetch()}
            showRetryButton
            showGoBackButton={false}
          />
        )}
        {showingFeatured &&
          !explore.isLoading &&
          !explore.isFetching &&
          !explore.error &&
          explore.data &&
          (browse === "genres" ? genres.length === 0 : authors.length === 0) && (
            <View style={{ gap: 4 }}>
              <ThemedText type="label">No featured {browse} yet</ThemedText>
              <ThemedText style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}>
                Search books above or browse the directory.
              </ThemedText>
            </View>
          )}
        {browse === "genres" && (
          <GenreBrowser
            genres={genres}
            expanded={showAllGenres}
            onToggle={() => setShowAllGenres((value) => !value)}
            directory={directory}
          />
        )}
        {browse === "authors" && (
          <AuthorBrowser
            authors={authors}
            expanded={showAuthorDirectory}
            onToggle={() => setShowAuthorDirectory((value) => !value)}
            query={authorQuery}
            onQueryChange={setAuthorQuery}
            directory={authorDirectory}
          />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchEntry: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  browseSwitch: { flexDirection: "row", borderRadius: 14, padding: 4 },
  browseTab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  languageButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    paddingHorizontal: 8,
  },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingTop: 16, gap: 8 },
});
