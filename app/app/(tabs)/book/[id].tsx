import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBookInfo } from "@/hooks/useBookhiveQuery";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { HiveId } from "../../../../src/types";

export default function BookInfo() {
  const { id } = useLocalSearchParams();
  const bookQuery = useBookInfo(
    typeof id === "string" ? (id as HiveId) : ("" as HiveId),
  );

  if (bookQuery.isLoading) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  if (bookQuery.error) {
    return <ThemedText>Error: {bookQuery.error.message}</ThemedText>;
  }

  return (
    <ThemedView style={styles.container}>
      <Text style={styles.title}>{bookQuery.data?.book.title}</Text>
      <Text style={styles.author}>{bookQuery.data?.book.authors}</Text>
      <Text style={styles.description}>{bookQuery.data?.book.description}</Text>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  author: {
    fontSize: 18,
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
  },
});
