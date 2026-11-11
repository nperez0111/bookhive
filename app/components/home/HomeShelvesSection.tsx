import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { MotionPressable } from "@/components/motion/MotionPressable";

import { SectionHeader } from "@/components/SectionHeader";
import { HeaderAction } from "@/components/HeaderAction";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

interface ShelfItem {
  uri: string;
  name: string;
  itemCount?: number;
}

export function HomeShelvesSection({
  shelves,
  onCreatePress,
}: {
  shelves: ShelfItem[];
  onCreatePress: () => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <View style={styles.section}>
      <SectionHeader
        icon="albums"
        title="Your Shelves"
        right={
          <View style={styles.headerRight}>
            <HeaderAction
              accessibilityLabel="Create shelf"
              onPress={onCreatePress}
              style={styles.shelfHeaderAction}
            >
              <Ionicons name="add" size={18} color={colors.accentForeground} />
            </HeaderAction>
            <HeaderAction
              title="See all"
              tone="neutral"
              onPress={() => router.push("/lists" as any)}
              accessibilityRole="button"
              accessibilityLabel="See all shelves"
              style={styles.shelfHeaderAction}
            />
          </View>
        }
        style={{ marginBottom: 16 }}
      />
      {shelves.length === 0 ? (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="Create your first shelf"
          pressedStyle={{ backgroundColor: colors.activeBackground }}
          onPress={onCreatePress}
          style={[styles.emptyState, { borderColor: colors.cardBorder }]}
        >
          <Ionicons name="albums-outline" size={26} color={colors.tertiaryText} />
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]}>
              No shelves yet
            </ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
              Create a shelf to curate your books
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.tertiaryText} />
        </MotionPressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelvesScroll}
        >
          {shelves.map((shelf) => (
            <MotionPressable
              key={shelf.uri}
              accessibilityRole="button"
              accessibilityLabel={`Open shelf ${shelf.name}, ${shelf.itemCount ?? 0} books`}
              pressedStyle={{ backgroundColor: colors.activeBackground }}
              style={[
                styles.shelfCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
              ]}
              onPress={() => router.push(`/lists/${encodeURIComponent(shelf.uri)}` as any)}
            >
              <View style={[styles.shelfIconBadge, { backgroundColor: colors.activeBackground }]}>
                <Ionicons name="albums" size={18} color={colors.primary} />
              </View>
              <ThemedText
                style={[styles.shelfCardName, { color: colors.primaryText }]}
                type="label"
                numberOfLines={2}
              >
                {shelf.name}
              </ThemedText>
              <ThemedText style={{ color: colors.tertiaryText }} type="caption">
                {shelf.itemCount ?? 0} {(shelf.itemCount ?? 0) === 1 ? "book" : "books"}
              </ThemedText>
            </MotionPressable>
          ))}
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="Create a new shelf"
            pressedStyle={{ backgroundColor: colors.activeBackground }}
            style={[styles.shelfCard, styles.shelfCardNew, { borderColor: colors.cardBorder }]}
            onPress={onCreatePress}
          >
            <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            <ThemedText style={[styles.shelfCardName, { color: colors.primary }]} type="label">
              New Shelf
            </ThemedText>
          </MotionPressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  shelfHeaderAction: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  emptyState: {
    marginHorizontal: 20,
    minHeight: 80,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyTitle: { marginBottom: 2, fontWeight: "600" },
  emptySubtitle: { fontSize: 14, lineHeight: 20 },
  shelvesScroll: { paddingHorizontal: 20, gap: 12 },
  shelfCard: { width: 140, borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  shelfCardNew: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderStyle: "dashed",
  },
  shelfIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfCardName: { fontWeight: "600" },
});
