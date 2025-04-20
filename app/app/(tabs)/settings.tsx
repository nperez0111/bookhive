import { useAuth } from "@/context/auth";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";

import {
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useProfile } from "@/hooks/useBookhiveQuery";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();

  return (
    <ScrollView style={styles.container}>
      <ThemedView style={styles.header}>
        <Image
          source={{
            uri: profile?.profile.avatar,
          }}
          style={styles.profileImage}
        />
        <ThemedText style={styles.name}>
          {profile?.profile.displayName}
        </ThemedText>
        <ThemedText style={styles.bio}>
          {profile?.profile.description}
        </ThemedText>
        <ThemedView style={styles.statsRow}>
          <ThemedView style={styles.stat}>
            <ThemedText style={styles.statNumber}>
              {profile?.profile.booksRead}
            </ThemedText>
            <ThemedText style={styles.statLabel}>Books Read</ThemedText>
          </ThemedView>
          <ThemedView style={styles.stat}>
            <ThemedText style={styles.statNumber}>
              {profile?.profile.reviews}
            </ThemedText>
            <ThemedText style={styles.statLabel}>Reviews</ThemedText>
          </ThemedView>
        </ThemedView>
      </ThemedView>

      {/* TODO: Add reading challenge */}
      {/* <ThemedView style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Reading Challenge</ThemedText>
        <ThemedView style={styles.challengeCard}>
          <ThemedView style={styles.challengeInfo}>
            <ThemedText style={styles.challengeTitle}>
              2025 Reading Challenge
            </ThemedText>
            <ThemedText style={styles.challengeProgress}>
              12 of 50 books read
            </ThemedText>
            <ThemedView style={styles.progressBarContainer}>
              <ThemedView style={[styles.progressBar, { width: "24%" }]} />
            </ThemedView>
          </ThemedView>
        </ThemedView>
      </ThemedView> */}

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Recent Activity</ThemedText>
        <View style={styles.activityList}>
          {profile?.activity.map((activity) => (
            <View style={styles.activityItem} key={activity.hiveId}>
              <Ionicons
                name={
                  activity.type === "rated"
                    ? "star"
                    : activity.type === "review"
                      ? "chatbubble"
                      : "book"
                }
                size={24}
                color="#6366f1"
              />
              <View style={styles.activityContent}>
                <ThemedText style={styles.activityText}>
                  {activity.type === "started"
                    ? "Started reading"
                    : activity.type === "finished"
                      ? "Finished reading"
                      : "Reviewed"}{" "}
                  <ThemedText style={styles.bold}>{activity.title}</ThemedText>
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>

      <ThemedView style={styles.section}>
        <TouchableOpacity style={styles.settingsButton} onPress={signOut}>
          <Ionicons name="log-out-outline" size={24} color="#EF4444" />
          <ThemedText style={[styles.settingsButtonText, { color: "#EF4444" }]}>
            Sign Out
          </ThemedText>
          <Ionicons name="chevron-forward" size={24} color="#EF4444" />
        </TouchableOpacity>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    alignItems: "center",
    padding: 24,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  bio: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 16,
  },
  stat: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "600",
    color: "#6366f1",
  },
  statLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  section: {
    marginTop: 24,
    marginBottom: 64,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
    marginHorizontal: 16,
    marginBottom: 16,
  },
  challengeCard: {
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  challengeInfo: {
    flex: 1,
  },
  challengeTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  challengeProgress: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: "#e5e7eb",
    borderRadius: 4,
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#6366f1",
    borderRadius: 4,
  },
  activityList: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    marginHorizontal: 16,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  activityContent: {
    marginLeft: 12,
    flex: 1,
  },
  activityText: {
    fontSize: 14,
    color: "#4b5563",
  },
  activityTime: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  bold: {
    fontWeight: "600",
    color: "#111827",
  },
  settingsButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  settingsButtonText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: "#4b5563",
  },
});
