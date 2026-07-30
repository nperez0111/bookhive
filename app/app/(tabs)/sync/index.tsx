import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedCard } from "@/components/ThemedCard";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl, useAuth } from "@/context/auth";
import { useRotateSyncPassword, useSyncDocuments, useSyncPassword } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

const SETUP_STEPS = [
  "Open a book on your KOReader device.",
  "Go to Settings → Progress sync → Custom sync server.",
  "Enter the sync server URL above.",
  "Choose Login and enter the username and password above.",
  "Tap “Push progress from this device now” to test it.",
  "For your uploads, add the OPDS catalog URL in KOReader’s OPDS browser with the same login.",
];

export default function SyncScreen() {
  const { authState } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { top } = useSafeAreaInsets();

  const passwordQuery = useSyncPassword();
  const rotatePassword = useRotateSyncPassword();
  const documentsQuery = useSyncDocuments();

  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(true);

  const documents = documentsQuery.data ?? [];
  const lastSync = useMemo(() => {
    if (documents.length === 0) return null;
    const newest = documents.reduce(
      (latest, doc) => (doc.updatedAt > latest ? doc.updatedAt : latest),
      documents[0].updatedAt,
    );
    try {
      return formatDistanceToNow(new Date(newest), { addSuffix: true });
    } catch {
      return null;
    }
  }, [documents]);
  const devices = useMemo(
    () => Array.from(new Set(documents.map((doc) => doc.device).filter(Boolean))) as string[],
    [documents],
  );

  const copy = useCallback(async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
  }, []);

  const handleReset = useCallback(() => {
    Alert.alert(
      "Reset sync password?",
      "The current password stops working immediately. You'll need to enter the new one on every device you sync with.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            rotatePassword.mutate(undefined, {
              onSuccess: () => {
                setRevealed(true);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              },
              onError: () =>
                Alert.alert("Couldn't reset", "Something went wrong. Please try again."),
            });
          },
        },
      ],
    );
  }, [rotatePassword]);

  const password = passwordQuery.data;
  const isConnected = documents.length > 0;

  const renderRow = (opts: {
    key: string;
    label: string;
    value?: string;
    secret?: boolean;
    loading?: boolean;
    hint?: string;
  }) => {
    const isCopied = copiedKey === opts.key;
    const display = opts.secret && !revealed ? "••••••••••••••••" : opts.value;

    return (
      <View key={opts.key} style={[styles.row, { borderTopColor: colors.cardBorder }]}>
        <View style={styles.rowHeader}>
          <ThemedText type="caption" style={{ color: colors.secondaryText }}>
            {opts.label}
          </ThemedText>
          <View style={styles.rowActions}>
            {opts.secret ? (
              <Pressable
                onPress={() => setRevealed((value) => !value)}
                hitSlop={10}
                accessibilityLabel={revealed ? "Hide password" : "Show password"}
              >
                <Ionicons
                  name={revealed ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.secondaryText}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => opts.value && copy(opts.key, opts.value)}
              disabled={!opts.value}
              hitSlop={10}
              accessibilityLabel={`Copy ${opts.label}`}
            >
              <Ionicons
                name={isCopied ? "checkmark-circle" : "copy-outline"}
                size={18}
                color={isCopied ? colors.success : colors.primary}
              />
            </Pressable>
          </View>
        </View>
        {opts.loading ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.rowLoading} />
        ) : (
          <ThemedText
            style={[styles.rowValue, { color: colors.primaryText }]}
            numberOfLines={opts.secret && !revealed ? 1 : 2}
            selectable={!opts.secret || revealed}
          >
            {display ?? "—"}
          </ThemedText>
        )}
        {opts.hint ? (
          <ThemedText type="caption" style={{ color: colors.tertiaryText, marginTop: 4 }}>
            {opts.hint}
          </ThemedText>
        ) : null}
      </View>
    );
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <BackNavigationHeader title="E-Reader Sync" style={{ paddingTop: top + 8 }} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Connection status — answers "is this working?" before anything else. */}
        <ThemedCard
          variant="outlined"
          style={[
            styles.statusCard,
            isConnected && {
              borderColor: colors.primary,
              backgroundColor: colors.activeBackground,
            },
          ]}
        >
          <View
            style={[
              styles.statusIcon,
              {
                backgroundColor: isConnected ? colors.primary : colors.inactiveBackground,
              },
            ]}
          >
            <Ionicons
              name={isConnected ? "sync" : "sync-outline"}
              size={20}
              color={isConnected ? "#fff" : colors.tertiaryText}
            />
          </View>
          <View style={styles.statusText}>
            <ThemedText type="label" style={{ color: colors.primaryText }}>
              {documentsQuery.isLoading
                ? "Checking…"
                : isConnected
                  ? `Syncing ${documents.length} ${documents.length === 1 ? "book" : "books"}`
                  : "No device connected yet"}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              {isConnected
                ? [
                    devices.length ? devices.join(", ") : null,
                    lastSync ? `updated ${lastSync}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Set up KOReader with the details below and your progress will appear here."}
            </ThemedText>
          </View>
        </ThemedCard>

        {/* Credentials */}
        <ThemedCard variant="outlined" style={styles.card}>
          <SectionHeader
            icon="key"
            title="Connection details"
            subtitle="The same login works for sync and the OPDS catalog"
            style={styles.cardHeader}
          />

          {renderRow({
            key: "server",
            label: "Sync server URL",
            value: `${getBaseUrl()}/kosync`,
          })}
          {renderRow({
            key: "opds",
            label: "OPDS catalog URL",
            value: `${getBaseUrl()}/opds`,
          })}
          {renderRow({
            key: "username",
            label: "Username",
            value: authState?.handle,
          })}
          {renderRow({
            key: "password",
            label: "Password",
            value: password,
            secret: true,
            loading: passwordQuery.isLoading,
          })}

          <Pressable
            onPress={handleReset}
            disabled={rotatePassword.isPending}
            style={({ pressed }) => [
              styles.resetButton,
              {
                borderColor: colors.cardBorder,
                backgroundColor: pressed ? colors.activeBackground : "transparent",
                opacity: rotatePassword.isPending ? 0.6 : 1,
              },
            ]}
          >
            {rotatePassword.isPending ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Ionicons name="refresh" size={16} color={colors.error} />
            )}
            <ThemedText type="label" style={{ color: colors.error }}>
              Reset password
            </ThemedText>
          </Pressable>
          <ThemedText type="caption" style={{ color: colors.tertiaryText, marginTop: 8 }}>
            Reset if the password leaked. Every device has to be updated afterwards.
          </ThemedText>
        </ThemedCard>

        {/* Setup steps */}
        <ThemedCard variant="outlined" style={styles.card}>
          <Pressable
            onPress={() => setStepsOpen((open) => !open)}
            style={styles.disclosureHeader}
            accessibilityRole="button"
          >
            <View style={[styles.disclosureIcon, { backgroundColor: colors.activeBackground }]}>
              <Ionicons name="book" size={20} color={colors.primary} />
            </View>
            <View style={styles.disclosureText}>
              <ThemedText type="heading" style={{ color: colors.primaryText }}>
                Set up KOReader
              </ThemedText>
              <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                Six steps, once per device
              </ThemedText>
            </View>
            <Ionicons
              name={stepsOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.tertiaryText}
            />
          </Pressable>

          {stepsOpen ? (
            <View style={styles.steps}>
              {SETUP_STEPS.map((step, index) => (
                <View key={step} style={styles.step}>
                  <View style={[styles.stepNumber, { backgroundColor: colors.activeBackground }]}>
                    <ThemedText type="caption" style={{ color: colors.primary, fontWeight: "700" }}>
                      {index + 1}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="body"
                    style={[styles.stepText, { color: colors.secondaryText }]}
                  >
                    {step}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}
        </ThemedCard>

        <Pressable
          onPress={() => router.push("/library" as any)}
          style={({ pressed }) => [
            styles.libraryLink,
            {
              borderColor: colors.cardBorder,
              backgroundColor: pressed ? colors.activeBackground : colors.cardBackground,
            },
          ]}
        >
          <View style={[styles.disclosureIcon, { backgroundColor: colors.activeBackground }]}>
            <Ionicons name="library" size={20} color={colors.primary} />
          </View>
          <View style={styles.disclosureText}>
            <ThemedText type="label" style={{ color: colors.primaryText }}>
              Your library
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              Upload books and match synced documents
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.tertiaryText} />
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 16,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    flex: 1,
    gap: 2,
  },
  card: {
    padding: 20,
  },
  cardHeader: {
    marginHorizontal: -8,
    paddingHorizontal: 0,
    marginBottom: 4,
  },
  row: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 12,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  rowValue: {
    fontFamily: "SpaceMono",
    fontSize: 13,
    lineHeight: 20,
  },
  rowLoading: {
    alignSelf: "flex-start",
    marginVertical: 2,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  disclosureHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  disclosureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disclosureText: {
    flex: 1,
    gap: 2,
  },
  steps: {
    marginTop: 16,
    gap: 12,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  libraryLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
});
