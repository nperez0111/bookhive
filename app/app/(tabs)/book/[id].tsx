import { ThemedText } from "@/components/ThemedText";
import { useBookInfo } from "@/hooks/useBookhiveQuery";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
} from "react-native";
import { HiveId } from "../../../../src/types";
import { decode } from "html-entities";

export default function BookInfo() {
  const { id } = useLocalSearchParams();
  const bookQuery = useBookInfo(
    typeof id === "string" ? (id as HiveId) : ("" as HiveId),
  );

  if (bookQuery.isLoading || !bookQuery.data) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  if (bookQuery.error) {
    return <ThemedText>Error: {bookQuery.error.message}</ThemedText>;
  }

  const { book } = bookQuery.data;
  const rating = book.rating ? book.rating / 1000 : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Image
          source={{
            uri: `http://localhost:8080/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
          }}
          style={styles.cover}
          resizeMode="cover"
        />
        <View style={styles.headerInfo}>
          <ThemedText style={styles.title}>{book.title}</ThemedText>
          <ThemedText style={styles.author}>
            by {book.authors.split("\t").join(", ")}
          </ThemedText>

          {book.rating && book.ratingsCount && (
            <View style={styles.ratingContainer}>
              <View style={styles.starsContainer}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <View key={star} style={styles.starWrapper}>
                    {/* Background star */}
                    <ThemedText style={[styles.star, styles.starBackground]}>
                      ★
                    </ThemedText>
                    {/* Filled star */}
                    <ThemedText
                      style={[
                        styles.star,
                        styles.starFilled,
                        {
                          width: `${Math.min(
                            100,
                            Math.max(0, (rating - (star - 1)) * 100),
                          )}%`,
                        },
                      ]}
                    >
                      ★
                    </ThemedText>
                  </View>
                ))}
              </View>
              <ThemedText style={styles.ratingText}>
                {rating.toFixed(1)} ({book.ratingsCount.toLocaleString()}{" "}
                ratings)
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      <View style={styles.descriptionContainer}>
        <ThemedText style={styles.description}>
          {decode(book.description || "No description available")}
        </ThemedText>
      </View>

      {book.sourceUrl && (
        <Pressable
          style={styles.sourceButton}
          onPress={() => {
            // Handle opening the source URL
          }}
        >
          <ThemedText style={styles.sourceButtonText}>{book.source}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 24,
  },
  headerInfo: {
    flex: 1,
    justifyContent: "flex-start",
  },
  cover: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  author: {
    fontSize: 16,
    marginBottom: 8,
    opacity: 0.8,
  },
  ratingContainer: {
    marginTop: 8,
  },
  starsContainer: {
    flexDirection: "row",
    marginBottom: 4,
  },
  starWrapper: {
    width: 20,
    height: 20,
    position: "relative",
  },
  star: {
    position: "absolute",
    fontSize: 18,
  },
  starBackground: {
    color: "#D1D5DB",
  },
  starFilled: {
    color: "#FBBF24",
    overflow: "hidden",
  },
  ratingText: {
    fontSize: 14,
    opacity: 0.6,
  },
  descriptionContainer: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
  },
  sourceButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#4B5563",
    borderRadius: 8,
    alignItems: "center",
  },
  sourceButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
