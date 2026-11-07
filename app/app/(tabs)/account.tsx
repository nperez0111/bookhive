import { useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { ThemedButton } from "@/components/ThemedButton";
import { AccountSection } from "@/components/account/AccountSection";
import { useAuth } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useDeleteAccount, useResyncBooks } from "@/hooks/useAccount";

export default function AccountScreen() {
  const { authState } = useAuth();
  const profile = useProfile();
  const expectedHandle = profile.data?.profile.handle ?? authState?.handle ?? "";
  const did = authState?.did ?? "";
  const [confirmHandle, setConfirmHandle] = useState("");
  const resync = useResyncBooks();
  const deletion = useDeleteAccount();
  const busy = resync.isPending || deletion.isPending;
  const confirmed =
    (Boolean(expectedHandle) && confirmHandle === expectedHandle) ||
    (Boolean(did) && confirmHandle === did);
  const deleteAccount = () =>
    Alert.alert(
      "Delete your BookHive data?",
      "This cannot be undone. Your Bluesky account and Bluesky posts are not deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete BookHive data",
          style: "destructive",
          onPress: () => deletion.mutate(confirmHandle),
        },
      ],
    );
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <BackNavigationHeader title="Account settings" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AccountSection
            title="Import your books"
            description="Bring your reading history from Goodreads, StoryGraph or Hardcover using a CSV export."
          >
            <ThemedButton
              title="Import CSV"
              disabled={busy}
              onPress={() => router.push("/import")}
            />
          </AccountSection>
          <AccountSection
            title="Book sync"
            description="Re-read your BookHive book records from your Bluesky data server. This does not import a CSV or restore deleted records."
          >
            <ThemedButton
              title="Re-sync books"
              loading={resync.isPending}
              disabled={busy}
              onPress={() => resync.mutate()}
            />
            {resync.isSuccess && (
              <ThemedText accessibilityLiveRegion="polite">Your books are up to date.</ThemedText>
            )}
            {resync.isError && (
              <ThemedText accessibilityRole="alert">
                Could not re-sync books. Check your connection and try again.
              </ThemedText>
            )}
          </AccountSection>
          <AccountSection
            title="Delete BookHive data"
            description="Permanently removes your indexed reading history, reviews, shelves, uploaded ebooks and device-sync data from BookHive. It also deletes BookHive book, review and list records from your PDS. It does not delete your Bluesky account or Bluesky posts."
          >
            <ThemedText>
              This cannot be undone. Type {expectedHandle || "your full handle"} exactly to confirm.
            </ThemedText>
            {!profile.data?.profile && (
              <ThemedText>
                Your profile is unavailable. Any displayed handle may be outdated.
              </ThemedText>
            )}
            {did && (
              <ThemedText selectable>
                If BookHive cannot retrieve your profile, type your DID exactly: {did}. The server
                accepts this fallback only when no profile is available; otherwise your current
                handle is required.
              </ThemedText>
            )}
            <ThemedTextInput
              style={styles.confirmInput}
              accessibilityLabel="Confirm your handle or DID"
              value={confirmHandle}
              onChangeText={setConfirmHandle}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              placeholder={expectedHandle}
            />
            <ThemedButton
              title="Delete BookHive data"
              variant="outline"
              loading={deletion.isPending}
              disabled={busy || !confirmed}
              onPress={deleteAccount}
            />
            {deletion.isError && (
              <ThemedText accessibilityRole="alert">
                Could not delete your data. Check your handle and connection, then try again.
              </ThemedText>
            )}
          </AccountSection>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 20 },
  confirmInput: { minHeight: 48, padding: 12, borderRadius: 12 },
});
