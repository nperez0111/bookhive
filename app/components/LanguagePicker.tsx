import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

/** Scrollable and searchable: Android alerts only support three buttons. */
export function LanguagePicker({
  visible,
  languages,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  languages: string[];
  selected: string | null;
  onSelect: (language: string | null) => void;
  onClose: () => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  const [search, setSearch] = useState("");
  const options = [null, ...Array.from(new Set(languages)).sort()].filter((language) =>
    (language ?? "All Languages").toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <ThemedText type="heading">Book Language</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
            <ThemedText style={{ color: colors.primary }}>Done</ThemedText>
          </Pressable>
        </View>
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
          ListEmptyComponent={<ThemedText>No matching languages.</ThemedText>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: item === selected }}
              onPress={() => {
                onSelect(item);
                onClose();
              }}
              style={[styles.row, { borderBottomColor: colors.cardBorder }]}
            >
              <ThemedText>{item ?? "All Languages"}</ThemedText>
              {item === selected ? (
                <ThemedText style={{ color: colors.primary }}>✓</ThemedText>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  button: { minWidth: 48, minHeight: 44, justifyContent: "center", alignItems: "center" },
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
