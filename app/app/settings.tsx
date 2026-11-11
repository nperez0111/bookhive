import { useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ListItem } from "@/components/ListItem";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedButton } from "@/components/ThemedButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useLanguage } from "@/context/language";
import { useLanguages } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const top = useScreenTopInset();
  const bottom = useBottomTabOverflow();
  const colors = Colors[useColorScheme() ?? "light"];
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const { preferredLanguage, setPreferredLanguage } = useLanguage();
  const { data: languages = [], isFetching, isError, refetch } = useLanguages();

  const checkForUpdate = async () => {
    if (__DEV__) {
      Alert.alert("Development Mode", "OTA updates are not available in development builds.");
      return;
    }
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        const result = await Updates.fetchUpdateAsync();
        if (result.isNew) {
          Alert.alert(
            "Update Available",
            "A new version has been downloaded. Restart now to apply it?",
            [
              { text: "Later", style: "cancel" },
              { text: "Restart", onPress: () => Updates.reloadAsync() },
            ],
          );
        }
      } else {
        Alert.alert("Up to Date", "You're running the latest version.");
      }
    } catch {
      Alert.alert("Update Check Failed", "Could not check for updates. Please try again later.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() =>
      Alert.alert("Unable to open link", `Please visit ${url}.`),
    );
  };

  return (
    <View style={{ flex: 1, paddingTop: top, backgroundColor: colors.background }}>
      <BackNavigationHeader
        title="Settings"
        onBackPress={() => (router.canGoBack() ? router.back() : router.navigate("/me"))}
      />
      <LanguagePicker
        visible={languagePickerOpen}
        languages={languages}
        selected={preferredLanguage}
        onSelect={setPreferredLanguage}
        onClose={() => setLanguagePickerOpen(false)}
        loading={isFetching}
        failed={isError}
        onRetry={() => void refetch()}
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: bottom + 24 }}>
        <View style={{ gap: 4 }}>
          <SectionHeader title="Preferences" style={{ paddingHorizontal: 0, marginBottom: 0 }} />
          <ThemeToggle />
          <ListItem
            icon="language"
            title="Book Language"
            subtitle={preferredLanguage || "All Languages"}
            onPress={() => {
              setLanguagePickerOpen(true);
              void refetch();
            }}
          />
        </View>
        <View style={{ gap: 4 }}>
          <ListItem
            icon="settings"
            title="Account Management"
            subtitle="Re-sync your books or delete your BookHive account"
            onPress={() => router.push("/account" as any)}
          />
        </View>
        <View style={{ gap: 4 }}>
          <SectionHeader
            title="About & Support"
            style={{ paddingHorizontal: 0, marginBottom: 0 }}
          />
          <ListItem
            icon="cloud-download"
            title={checkingUpdate ? "Checking..." : "Check for Updates"}
            onPress={() => void checkForUpdate()}
          />
          <ListItem
            icon="bug-outline"
            title="Report a Bug"
            onPress={() => openLink("https://github.com/nperez0111/bookhive/issues")}
          />
          <ListItem
            icon="document-text"
            title="Terms of Service"
            onPress={() => openLink("https://bookhive.buzz/legal")}
          />
          <ListItem
            icon="shield-checkmark"
            title="Privacy Policy"
            onPress={() => openLink("https://bookhive.buzz/privacy-policy")}
          />
        </View>
        <ThemedButton
          title="Sign Out"
          onPress={signOut}
          variant="outline"
          leftIcon={<Ionicons name="log-out" size={20} color={colors.error} />}
          style={{ borderColor: colors.error }}
          textStyle={{ color: colors.error }}
        />
      </ScrollView>
    </View>
  );
}
