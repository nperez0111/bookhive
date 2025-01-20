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
import { useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useState } from "react";

export default function HomeScreen() {
  const { signOut } = useAuth();
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useSearchBooks(query);

  return (
    <FlatList
      ListHeaderComponent={
        <View>
          <View style={styles.titleContainer}>
            <ThemedText type="title">Welcome!</ThemedText>
            <HelloWave />
          </View>
          <Button title="Sign Out" onPress={signOut} />
          <TextInput
            style={{
              height: 40,
              borderColor: "gray",
              borderWidth: 1,
              marginBottom: 16,
              padding: 8,
              borderRadius: 4,
            }}
            placeholder="Search books..."
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoComplete="off"
            focusable
          />
          {isLoading && <ActivityIndicator size="large" color="#0000ff" />}
          {error && <ThemedText>Error: {error.message}</ThemedText>}
        </View>
      }
      data={data || []}
      keyExtractor={(item) => item.id}
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
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: "absolute",
  },
  cover: {
    width: 75,
    height: 125,
  },
});
