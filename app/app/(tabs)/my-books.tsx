import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ActionSheet } from "@/components/ActionSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HeaderAction } from "@/components/HeaderAction";
import { TrackedBooksContent } from "@/components/tracked-books/TrackedBooksContent";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

export default function MyBooksScreen() {
  const { authState } = useAuth();
  const colors = Colors[useColorScheme() ?? "light"];
  const top = useScreenTopInset();
  const [toolsOpen, setToolsOpen] = useState(false);
  return (
    <View style={[styles.screen, { paddingTop: top, backgroundColor: colors.background }]}>
      <ScreenHeader
        title="My Books"
        actions={
          <>
            <HeaderAction accessibilityLabel="Find books" onPress={() => router.push("/search")}>
              <Ionicons name="search-outline" size={20} color={colors.accentForeground} />
            </HeaderAction>
            <HeaderAction
              title="Tools"
              tone="neutral"
              accessibilityLabel="Library tools"
              onPress={() => setToolsOpen(true)}
            />
          </>
        }
      />
      <TrackedBooksContent />
      <ActionSheet
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        title="Library tools"
        actions={[
          {
            key: "shelves",
            label: "Shelves",
            icon: "albums-outline",
            onPress: () => {
              setToolsOpen(false);
              router.push("/lists" as any);
            },
          },
          {
            key: "ebooks",
            label: "Ebooks",
            icon: "tablet-portrait-outline",
            onPress: () => {
              setToolsOpen(false);
              router.push("/library" as any);
            },
          },
          {
            key: "stats",
            label: "Reading stats",
            icon: "stats-chart-outline",
            onPress: () => {
              setToolsOpen(false);
              if (authState?.did) router.push(`/profile/${authState.did}/stats` as any);
            },
          },
          {
            key: "import",
            label: "Import",
            icon: "download-outline",
            onPress: () => {
              setToolsOpen(false);
              router.push("/import" as any);
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
