import {
  ActivityIndicator,
  Button,
  FlatList,
  Image,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { HelloWave } from "@/components/HelloWave";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useAuth } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";

export default function HomeScreen() {
  const { signOut } = useAuth();
  const profile = useProfile();

  if (!profile.data) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  return (
    <FlatList
      ListHeaderComponent={
        <View>
          <View style={styles.titleContainer}>
            <ThemedText type="subtitle">
              Welcome, {profile.data.profile.displayName}!
            </ThemedText>
            <HelloWave />
          </View>
          {profile.isLoading && (
            <ActivityIndicator size="large" color="#0000ff" />
          )}
          {profile.error && (
            <ThemedText>Error: {profile.error.message}</ThemedText>
          )}
        </View>
      }
      data={profile.data.books}
      keyExtractor={(item) => item.hiveId}
      renderItem={({ item: book }) => (
        <ThemedView style={{ padding: 8, flexDirection: "row", gap: 8 }}>
          <Image
            source={{
              uri: `http://localhost:8080/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
            }}
            style={styles.cover}
          />
          <View>
            <ThemedText type="subtitle">{book.title}</ThemedText>
            <ThemedText>{book.authors}</ThemedText>
          </View>
        </ThemedView>
      )}
      ListHeaderComponentStyle={{ padding: 16 }}
    />
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  cover: {
    width: 75,
    height: 125,
  },
});
