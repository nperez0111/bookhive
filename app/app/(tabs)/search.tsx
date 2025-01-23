import {
  ActivityIndicator,
  Button,
  FlatList,
  Image,
  Pressable,
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
import { router } from "expo-router";
import { useThemeColor } from "@/hooks/useThemeColor";

export default function HomeScreen() {
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useSearchBooks(query);
  const color = useThemeColor({}, "text");

  return (
    <FlatList
      ListHeaderComponent={
        <View>
          <TextInput
            style={[{ color }, styles.searchBox]}
            placeholder="Search books..."
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoComplete="off"
            focusable
            clearButtonMode="while-editing"
            autoCapitalize="none"
          />
          {isLoading && <ActivityIndicator size="large" color="#0000ff" />}
          {error && <ThemedText>Error: {error.message}</ThemedText>}
        </View>
      }
      data={data || []}
      keyExtractor={(item) => item.id}
      renderItem={({ item: book }) => (
        <Pressable
          onPress={() => router.push(`/book/${book.id}`)}
          style={{ padding: 8, flexDirection: "row", gap: 8 }}
        >
          <Image
            source={{
              uri: `http://localhost:8080/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
            }}
            style={styles.cover}
          />
          <View>
            <ThemedText type="subtitle">{book.title}</ThemedText>
            <ThemedText>{book.authors}</ThemedText>
          </View>
        </Pressable>
      )}
      ListHeaderComponentStyle={{ padding: 16 }}
    />
  );
}

const styles = StyleSheet.create({
  searchBox: {
    height: 40,
    borderColor: "gray",
    borderWidth: 1,
    marginBottom: 8,
    padding: 8,
    borderRadius: 4,
    marginTop: 24,
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
