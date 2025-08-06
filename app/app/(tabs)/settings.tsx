import { useAuth } from "@/context/auth";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedCard } from "@/components/ThemedCard";
import { ThemedButton } from "@/components/ThemedButton";
import { GradientView } from "@/components/GradientView";
import { ThemeToggle } from "@/components/ThemeToggle";

import {
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  View,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { router } from "expo-router";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section with Gradient */}
        <GradientView variant="warm" style={styles.headerSection}>
          <ThemedText
            style={[
              styles.headerTitle,
              { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" },
            ]}
            type="title"
          >
            Profile
          </ThemedText>
          <ThemedText
            style={[
              styles.headerSubtitle,
              { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" },
            ]}
            type="body"
          >
            Manage your account and preferences
          </ThemedText>
        </GradientView>

        {/* Profile Card */}
        <View style={styles.profileSection}>
          <ThemedCard variant="elevated" style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <View
                style={[
                  styles.profileImageContainer,
                  { backgroundColor: colors.inactiveBackground },
                ]}
              >
                {profile?.profile.avatar ? (
                  <Image
                    source={{ uri: profile.profile.avatar }}
                    style={styles.profileImage}
                  />
                ) : (
                  <Ionicons
                    name="person"
                    size={40}
                    color={colors.tertiaryText}
                  />
                )}
              </View>
              <View style={styles.profileInfo}>
                <ThemedText
                  style={[styles.profileName, { color: colors.primaryText }]}
                  type="heading"
                >
                  {profile?.profile.displayName || "User"}
                </ThemedText>
                <ThemedText
                  style={[styles.profileBio, { color: colors.secondaryText }]}
                  type="body"
                  numberOfLines={2}
                >
                  {profile?.profile.description || "No bio available"}
                </ThemedText>
              </View>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                  type="title"
                >
                  {profile?.profile.booksRead || 0}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.secondaryText }]}
                  type="caption"
                >
                  Books Read
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statDivider,
                  { backgroundColor: colors.cardBorder },
                ]}
              />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                  type="title"
                >
                  {profile?.profile.reviews || 0}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.secondaryText }]}
                  type="caption"
                >
                  Reviews
                </ThemedText>
              </View>
            </View>
          </ThemedCard>
        </View>

        {/* Settings Sections */}
        <View style={styles.settingsSection}>
          <ThemedCard variant="outlined" style={styles.settingsCard}>
            <View style={styles.sectionHeader}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: colors.activeBackground },
                ]}
              >
                <Ionicons name="settings" size={20} color={colors.primary} />
              </View>
              <ThemedText
                style={[styles.sectionTitle, { color: colors.primaryText }]}
                type="heading"
              >
                Settings
              </ThemedText>
            </View>

            {/* Settings Items */}
            <View style={styles.settingsList}>
              <ThemeToggle style={styles.settingItem} />
            </View>
          </ThemedCard>
        </View>

        {/* Sign Out Button */}
        <View style={styles.signOutSection}>
          <ThemedButton
            title="Sign Out"
            onPress={signOut}
            variant="outline"
            leftIcon={
              <Ionicons name="log-out" size={20} color={colors.error} />
            }
            style={styles.signOutButton}
            textStyle={{ color: colors.error }}
          />
        </View>

        {/* Support Section */}
        <View style={styles.supportSection}>
          <ThemedCard variant="outlined" style={styles.supportCard}>
            <View style={styles.sectionHeader}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: colors.activeBackground },
                ]}
              >
                <Ionicons name="help-circle" size={20} color={colors.primary} />
              </View>
              <ThemedText
                style={[styles.sectionTitle, { color: colors.primaryText }]}
                type="heading"
              >
                Support
              </ThemedText>
            </View>

            <View style={styles.settingsList}>
              <Pressable style={styles.settingItem}>
                <View style={styles.settingLeft}>
                  <Ionicons
                    name="document-text"
                    size={20}
                    color={colors.secondaryText}
                  />
                  <ThemedText
                    style={[styles.settingText, { color: colors.primaryText }]}
                    type="body"
                  >
                    Help & FAQ
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.tertiaryText}
                />
              </Pressable>

              <Pressable style={styles.settingItem}>
                <View style={styles.settingLeft}>
                  <Ionicons
                    name="mail"
                    size={20}
                    color={colors.secondaryText}
                  />
                  <ThemedText
                    style={[styles.settingText, { color: colors.primaryText }]}
                    type="body"
                  >
                    Contact Support
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.tertiaryText}
                />
              </Pressable>
            </View>
          </ThemedCard>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginBottom: 20,
  },
  scrollView: {
    flex: 1,
  },
  headerSection: {
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    marginBottom: 8,
  },
  headerSubtitle: {
    lineHeight: 24,
  },
  profileSection: {
    margin: 20,
  },
  profileCard: {
    padding: 24,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  profileImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    marginBottom: 4,
  },
  profileBio: {
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statNumber: {
    marginBottom: 4,
  },
  statLabel: {
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  settingsSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  settingsCard: {
    padding: 20,
  },
  supportSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  supportCard: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  sectionTitle: {
    flex: 1,
  },
  settingsList: {
    gap: 8,
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingText: {
    flex: 1,
  },
  signOutSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  signOutButton: {
    borderColor: "#ef4444",
  },
  bottomSpacing: {
    height: 20,
  },
});
