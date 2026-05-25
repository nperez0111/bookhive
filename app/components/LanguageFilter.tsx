import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useLanguage } from "@/context/language";
import { useLanguages } from "@/hooks/useBookhiveQuery";

interface LanguageFilterProps {
  /** Override the current language selection (for local state usage) */
  selectedLanguage?: string | null;
  /** Called when language selection changes */
  onLanguageChange?: (language: string | null) => void;
  /** If true, uses global preference from LanguageProvider instead of local state */
  useGlobalPreference?: boolean;
  style?: any;
}

/**
 * A horizontal scrollable chip bar for filtering by language.
 * Shows "All" chip + available languages from the server.
 */
export function LanguageFilter({
  selectedLanguage: overrideSelected,
  onLanguageChange,
  useGlobalPreference = true,
  style,
}: LanguageFilterProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const { preferredLanguage, setPreferredLanguage } = useLanguage();
  const { data: languages = [] } = useLanguages();

  const currentLanguage = overrideSelected !== undefined ? overrideSelected : preferredLanguage;

  const handleSelect = (language: string | null) => {
    if (onLanguageChange) {
      onLanguageChange(language);
    }
    if (useGlobalPreference) {
      setPreferredLanguage(language);
    }
  };

  if (languages.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* "All" chip */}
        <Pressable
          onPress={() => handleSelect(null)}
          style={[
            styles.chip,
            {
              backgroundColor: !currentLanguage ? colors.primary : colors.inactiveBackground,
              borderColor: !currentLanguage ? colors.primary : colors.cardBorder,
            },
          ]}
        >
          <Ionicons
            name="globe-outline"
            size={14}
            color={!currentLanguage ? "#fff" : colors.secondaryText}
          />
          <ThemedText
            style={[styles.chipText, { color: !currentLanguage ? "#fff" : colors.secondaryText }]}
            type="caption"
          >
            All
          </ThemedText>
        </Pressable>

        {languages.map((lang) => {
          const isActive = currentLanguage === lang;
          return (
            <Pressable
              key={lang}
              onPress={() => handleSelect(lang)}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? colors.primary : colors.inactiveBackground,
                  borderColor: isActive ? colors.primary : colors.cardBorder,
                },
              ]}
            >
              <ThemedText
                style={[styles.chipText, { color: isActive ? "#fff" : colors.secondaryText }]}
                type="caption"
              >
                {lang}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
  },
});
