import { useAuth } from "@/context/auth";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";

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
        {/* Header Section */}
        <View style={styles.headerSection}>
          <ThemedText
            style={[
              styles.headerTitle,
              { color: colorScheme === "dark" ? "white" : colors.text },
            ]}
          >
            Profile
          </ThemedText>
          <ThemedText
            style={[
              styles.headerSubtitle,
              { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
            ]}
          >
            Manage your account and preferences
          </ThemedText>
        </View>

        {/* Profile Card */}
        <View style={styles.profileSection}>
          <View
            style={[
              styles.profileCard,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <View style={styles.profileHeader}>
              <Image
                source={{
                  uri: profile?.profile.avatar,
                }}
                style={styles.profileImage}
              />
              <View style={styles.profileInfo}>
                <ThemedText
                  style={[
                    styles.profileName,
                    { color: colorScheme === "dark" ? "white" : colors.text },
                  ]}
                >
                  {profile?.profile.displayName}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.profileBio,
                    { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                  ]}
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
                >
                  {profile?.profile.booksRead || 0}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.statLabel,
                    { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                  ]}
                >
                  Books Read
                </ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                >
                  {profile?.profile.reviews || 0}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.statLabel,
                    { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                  ]}
                >
                  Reviews
                </ThemedText>
              </View>
            </View>
          </View>
        </View>

        {/* Recent Activity Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderContent}>
              <Ionicons name="time-outline" size={24} color={colors.primary} />
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Recent Activity
              </ThemedText>
            </View>
          </View>

          {profile?.activity && profile.activity.length > 0 ? (
            <View
              style={[
                styles.activityCard,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              {profile.activity.map((activity, i, all) => (
                <Pressable
                  style={[
                    styles.activityItem,
                    {
                      borderBottomColor: colors.cardBorder,
                      borderBottomWidth: i === all.length - 1 ? 0 : 1,
                    },
                  ]}
                  key={activity.hiveId}
                  onPress={() => router.push(`/book/${activity.hiveId}`)}
                >
                  <View
                    style={[
                      styles.activityIcon,
                      {
                        backgroundColor: colors.activeBackground,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        activity.type === "rated"
                          ? "star"
                          : activity.type === "review"
                            ? "chatbubble"
                            : "book"
                      }
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.activityContent}>
                    <ThemedText
                      style={[
                        styles.activityText,
                        {
                          color: colorScheme === "dark" ? "white" : colors.text,
                        },
                      ]}
                    >
                      {activity.type === "started"
                        ? "Started reading"
                        : activity.type === "finished"
                          ? "Finished reading"
                          : "Reviewed"}{" "}
                      <ThemedText style={styles.bold}>
                        {activity.title}
                      </ThemedText>
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View
              style={[
                styles.emptyState,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={48}
                color={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
              />
              <ThemedText
                style={[
                  styles.emptyTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                No Recent Activity
              </ThemedText>
              <ThemedText
                style={[
                  styles.emptySubtitle,
                  { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                ]}
              >
                Your reading activity will appear here
              </ThemedText>
            </View>
          )}
        </View>

        {/* Settings Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderContent}>
              <Ionicons
                name="settings-outline"
                size={24}
                color={colors.primary}
              />
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Account
              </ThemedText>
            </View>
          </View>

          <Pressable
            style={[
              styles.settingsButton,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
              },
            ]}
            onPress={signOut}
          >
            <View
              style={[
                styles.settingsIcon,
                {
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                },
              ]}
            >
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            </View>
            <ThemedText
              style={[styles.settingsButtonText, { color: "#EF4444" }]}
            >
              Sign Out
            </ThemedText>
            <Ionicons name="chevron-forward" size={20} color="#EF4444" />
          </Pressable>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    lineHeight: 36,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  profileCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 4,
  },
  profileBio: {
    fontSize: 14,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: 20,
    height: 40,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  activityCard: {
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bold: {
    fontWeight: "600",
  },
  emptyState: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  settingsButton: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  settingsButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  bottomSpacing: {
    height: 20,
  },
});
