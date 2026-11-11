import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { ThemedButton } from "@/components/ThemedButton";
import { HeaderAction } from "@/components/HeaderAction";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

type Props = {
  visible: boolean;
  languages: string[];
  selected: string | null;
  onSelect: (language: string | null) => void;
  onClose: () => void;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
};

/** Each opening starts a fresh search; the catalogue selection lives in the caller. */
export function LanguagePicker(props: Props) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      {props.visible ? <LanguagePickerContent {...props} /> : null}
    </Modal>
  );
}

function LanguagePickerContent({
  languages,
  selected,
  onSelect,
  onClose,
  loading = false,
  failed = false,
  onRetry,
}: Props) {
  const colors = Colors[useColorScheme() ?? "light"];
  const [search, setSearch] = useState("");
  const options = [null, ...Array.from(new Set(languages)).sort()].filter((language) =>
    (language ?? "All Languages").toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView
        accessibilityViewIsModal
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: colors.background, borderBottomColor: colors.cardBorder },
          ]}
        >
          <ThemedText accessibilityRole="header" type="heading" style={{ flexShrink: 1 }}>
            Book Language
          </ThemedText>
          <HeaderAction title="Done" tone="neutral" onPress={onClose} />
        </View>
        <ThemedText style={{ fontSize: 14, lineHeight: 20, color: colors.secondaryText }}>
          Filters catalogue search and discovery, not your tracked books or ebooks.
        </ThemedText>
        <TextInput
          accessibilityLabel="Search languages"
          placeholder="Search languages"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          placeholderTextColor={colors.secondaryText}
          style={[styles.search, { color: colors.primaryText, borderColor: colors.cardBorder }]}
        />
        <FlatList
          data={options}
          keyExtractor={(language) => language ?? "all"}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            loading ? (
              <View style={styles.notice}>
                <ActivityIndicator color={colors.primary} />
                <ThemedText type="caption">Loading languages…</ThemedText>
              </View>
            ) : failed ? (
              <View style={styles.notice}>
                <ThemedText accessibilityRole="alert">Could not load language filters.</ThemedText>
                {onRetry ? (
                  <ThemedButton title="Try again" variant="outline" onPress={onRetry} />
                ) : null}
              </View>
            ) : languages.length === 0 ? (
              <View style={styles.notice}>
                <ThemedText>No language filters are available in this catalogue yet.</ThemedText>
                <ThemedText type="caption">
                  A language becomes available when at least five books have it recorded. You can
                  still browse all books.
                </ThemedText>
                {onRetry ? (
                  <ThemedButton title="Refresh languages" variant="outline" onPress={onRetry} />
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={<ThemedText>No matching languages.</ThemedText>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={item ?? "All Languages"}
              accessibilityState={{ checked: item === selected }}
              onPress={() => {
                onSelect(item);
                onClose();
              }}
              style={[styles.row, { borderBottomColor: colors.cardBorder }]}
            >
              <ThemedText>{item ?? "All Languages"}</ThemedText>
              {item === selected ? (
                <ThemedText accessible={false} style={{ color: colors.accentForeground }}>
                  ✓
                </ThemedText>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  notice: { gap: 12, paddingVertical: 16 },
  header: {
    flexShrink: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginVertical: 16,
  },
  row: {
    minHeight: 52,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
