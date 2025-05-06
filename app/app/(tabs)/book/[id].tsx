import { ThemedText } from "@/components/ThemedText";
import { useBookInfo, useUpdateBook } from "@/hooks/useBookhiveQuery";
import { useLocalSearchParams, router } from "expo-router";
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  Linking,
  TouchableOpacity,
  FlatList,
  TextInput,
  PanResponder,
  ViewStyle,
} from "react-native";
import type { HiveId } from "../../../../src/types";
import {
  BOOK_STATUS_MAP,
  BOOK_STATUS,
  type BookStatus,
} from "../../../constants/index";
import { decode } from "html-entities";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect, useRef } from "react";
import { ThemedView } from "@/components/ThemedView";
import { getBaseUrl } from "@/context/auth";
import { useThemeColor } from "@/hooks/useThemeColor";

const STATUS_OPTIONS = [
  BOOK_STATUS.FINISHED,
  BOOK_STATUS.READING,
  BOOK_STATUS.WANTTOREAD,
  BOOK_STATUS.ABANDONED,
];

// Star Rating Component
interface StarRatingProps {
  /** rating (0-10, supports half steps like 1, 3, 5...) */
  rating: number | undefined;
  onRate: (rating: number) => void;
  disabled?: boolean;
  starSize?: number;
  style?: ViewStyle;
}

const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRate,
  disabled = false,
  starSize = 32,
  style,
}) => {
  // Internal state represents 0-5 stars (including halves) based on 0-10 rating prop
  const [currentRating, setCurrentRating] = useState(
    rating !== undefined ? rating / 2 : 0,
  );
  const layoutRef = useRef({ width: 0, x: 0 }); // Ref to hold layout for handlers

  useEffect(() => {
    // Update internal state if the prop changes (e.g., after successful fetch/mutation)
    setCurrentRating(rating !== undefined ? rating / 2 : 0);
  }, [rating]);

  const calculateRating = (gestureX: number): number => {
    // Use layout from ref inside the calculation triggered by PanResponder
    const layout = layoutRef.current;
    if (!layout.width) return currentRating;

    const relativeX = gestureX - layout.x;
    const touchPercentage = Math.max(0, Math.min(1, relativeX / layout.width));
    const rawRating = touchPercentage * 5; // 0-5 scale

    // Round to nearest half-star
    const halfStarRating = Math.round(rawRating * 2) / 2;
    const finalRating = Math.max(0.5, Math.min(5, halfStarRating)); // Ensure rating is between 0.5 and 5
    return finalRating;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        setCurrentRating(newRating);
      },
      onPanResponderMove: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        setCurrentRating(newRating);
      },
      onPanResponderRelease: () => {
        // Call the onRate callback only when the gesture ends
        onRate(currentRating * 2); // Convert 0-5 (half steps) back to 0-10
      },
    }),
  ).current;

  return (
    <View
      style={[styles.starRatingContainer, style]}
      {...panResponder.panHandlers} // Attach gesture handlers
      onLayout={(event) => {
        // Get the layout info (width and position) of the container
        const { width, x } = event.nativeEvent.layout;
        layoutRef.current = { width, x };
      }}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const starValue = index + 1;
        let iconName: React.ComponentProps<typeof Ionicons>["name"] =
          "star-outline";
        if (currentRating >= starValue) {
          iconName = "star";
        } else if (currentRating > index && currentRating < starValue) {
          // Handle half stars
          iconName = "star-half-sharp";
        }

        return (
          <View key={index} style={styles.starIconWrapper}>
            <Ionicons
              name={iconName}
              size={starSize}
              color={currentRating >= index + 0.5 ? "#FBBF24" : "#D1D5DB"}
            />
          </View>
        );
      })}
    </View>
  );
};

export default function BookInfo() {
  const { id: hiveId } = useLocalSearchParams<{ id: HiveId }>();
  const textColor = useThemeColor({}, "text");
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<BookStatus | null>(null);
  const [userReviewText, setUserReviewText] = useState("");

  const bookQuery = useBookInfo(hiveId);
  const updateBook = useUpdateBook();
  const handleStatusUpdate = async (status: NonNullable<BookStatus>) => {
    let currentStatus = selectedStatus;
    setSelectedStatus(status);
    try {
      await updateBook.mutateAsync({
        hiveId: hiveId,
        status: status,
      });
    } catch (error) {
      console.error("Failed to update status:", error);
      setSelectedStatus(currentStatus);
    } finally {
      setModalVisible(false);
    }
  };

  const handleAddReview = async () => {
    if (!userReviewText.trim()) {
      // Maybe show an alert?
      return;
    }
    try {
      await updateBook.mutateAsync({
        hiveId: hiveId,
        review: userReviewText,
      });
      // Optionally clear the input or show success message
      setUserReviewText("");
    } catch (e) {
      // Error is handled by the hook's error state
      console.error("Failed to add review:", e);
    }
  };

  const handleRatingUpdate = async (newRating: number) => {
    await updateBook.mutateAsync({
      hiveId: hiveId,
      stars: newRating,
    });
  };

  if (bookQuery.isLoading) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  if (bookQuery.error) {
    return <ThemedText>Error: {bookQuery.error.message}</ThemedText>;
  }

  const { book, reviews, comments, ...userBook } = bookQuery.data!;
  const rating = book.rating ? book.rating / 1000 : 0;
  const status = (userBook.status ?? selectedStatus) as BookStatus | null;
  const review = userReviewText || userBook.review;

  return (
    <View style={styles.mainContainer}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color="#666" />
      </Pressable>

      <ScrollView style={styles.container}>
        <View style={styles.contentContainer}>
          {/* Book Cover Section */}
          <View style={styles.coverContainer}>
            <Image
              source={{
                uri: `${getBaseUrl()}/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
              }}
              style={styles.cover}
              resizeMode="cover"
            />
          </View>

          {/* Book Info Section */}
          <View style={styles.infoContainer}>
            <ThemedText style={styles.title}>{book.title}</ThemedText>
            <ThemedText style={styles.author}>
              by {book.authors.split("\t").join(", ")}
            </ThemedText>

            {/* Rating Section */}
            {book.rating && book.ratingsCount && (
              <View style={styles.ratingContainer}>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <View key={star} style={styles.starWrapper}>
                      <ThemedText style={[styles.star, styles.starBackground]}>
                        ★
                      </ThemedText>
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
                  {rating.toFixed(2)} ({book.ratingsCount.toLocaleString()}{" "}
                  ratings)
                </ThemedText>
              </View>
            )}

            {/* Status Button / Dropdown Trigger */}
            <Pressable
              style={styles.statusButton}
              onPress={() => setModalVisible(true)}
            >
              <ThemedText style={styles.statusButtonText}>
                {status ? BOOK_STATUS_MAP[status] : "Add to Shelf"}
              </ThemedText>
              <Ionicons
                name="chevron-down"
                size={16}
                color="white"
                style={{ marginLeft: 8 }}
              />
            </Pressable>

            {/* Status Selection Modal */}
            <Modal
              animationType="fade"
              transparent={true}
              visible={modalVisible}
              onRequestClose={() => {
                setModalVisible(!modalVisible);
              }}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={() => setModalVisible(false)}
              >
                <ThemedView
                  style={styles.modalView}
                  onStartShouldSetResponder={() => true}
                >
                  {updateBook.isPending ? (
                    <ActivityIndicator
                      size="large"
                      color="#4CAF50"
                      style={{ paddingVertical: 20 }}
                    />
                  ) : (
                    <FlatList
                      data={STATUS_OPTIONS}
                      keyExtractor={(item) => item}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[styles.modalOption]}
                          onPress={() => handleStatusUpdate(item)}
                        >
                          <ThemedText
                            style={[styles.modalOptionText]}
                            type={
                              status === item ? "defaultSemiBold" : "default"
                            }
                            themeSource={status === item ? "tint" : "text"}
                          >
                            {BOOK_STATUS_MAP[item]}
                          </ThemedText>
                        </TouchableOpacity>
                      )}
                      ItemSeparatorComponent={() => (
                        <View style={styles.separator} />
                      )}
                    />
                  )}
                </ThemedView>
              </Pressable>
            </Modal>

            {/* Display mutation error if any */}
            {updateBook.error && (
              <ThemedText style={styles.errorText}>
                Error updating status: {updateBook.error.message}
              </ThemedText>
            )}

            {/* Description */}
            <View style={styles.descriptionContainer}>
              <ThemedText style={styles.description}>
                {decode(book.description || "No description available")}
              </ThemedText>
            </View>

            {/* Source Button */}
            {book.sourceUrl && (
              <Pressable
                style={styles.sourceButton}
                onPress={() => {
                  if (book.sourceUrl) {
                    Linking.openURL(book.sourceUrl);
                  }
                }}
              >
                <ThemedText style={styles.sourceButtonText}>
                  {book.source}
                </ThemedText>
              </Pressable>
            )}

            {/* Review Section */}
            <View style={styles.reviewSectionContainer}>
              <ThemedText style={styles.ratingTitle}>Your Rating</ThemedText>
              <StarRating
                rating={userBook.stars}
                onRate={handleRatingUpdate}
                disabled={updateBook.isPending}
              />
              <ThemedText style={styles.reviewTitle}>Your Review</ThemedText>
              <TextInput
                style={[styles.reviewInput, { color: textColor }]}
                placeholder="Write your review..."
                value={review}
                onChangeText={setUserReviewText}
                multiline
                placeholderTextColor="#9CA3AF"
              />
              <Pressable
                style={[
                  styles.submitButton,
                  updateBook.isPending && styles.submitButtonDisabled,
                ]}
                onPress={handleAddReview}
                disabled={updateBook.isPending}
              >
                {updateBook.isPending ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <ThemedText style={styles.submitButtonText}>
                    Submit Review
                  </ThemedText>
                )}
              </Pressable>
              {updateBook.error && (
                <ThemedText style={styles.errorText}>
                  Error submitting review: {updateBook.error.message}
                </ThemedText>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    position: "relative",
    marginTop: 24,
    marginBottom: 56,
  },
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1,
    padding: 8,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    alignItems: "center",
    paddingTop: 56,
  },
  coverContainer: {
    marginTop: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cover: {
    width: 200,
    height: 300,
    borderRadius: 12,
  },
  infoContainer: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  author: {
    fontSize: 16,
    marginBottom: 12,
    opacity: 0.8,
    textAlign: "center",
  },
  ratingContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: "row",
    marginBottom: 4,
  },
  starWrapper: {
    width: 24,
    height: 24,
    position: "relative",
  },
  star: {
    position: "absolute",
    fontSize: 22,
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
  statusButton: {
    flexDirection: "row",
    backgroundColor: "#4CAF50",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    marginVertical: 16,
    width: "80%",
    alignItems: "center",
    justifyContent: "center",
  },
  statusButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  descriptionContainer: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    width: "100%",
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "left",
  },
  sourceButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#4B5563",
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  sourceButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalView: {
    margin: 20,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "stretch",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: "80%",
    maxHeight: "50%",
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  modalOptionText: {
    fontSize: 16,
    textAlign: "center",
  },
  separator: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 15,
  },
  errorText: {
    color: "red",
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
    width: "90%",
  },

  starRatingContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 16,
  },
  starIconWrapper: {
    marginHorizontal: 2,
  },
  ratingTitle: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 8,
  },
  reviewSectionContainer: {
    marginTop: 36,
    width: "100%",
    alignItems: "center",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  reviewTitle: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 12,
  },
  reviewInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    width: "100%",
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: "#10B981",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    width: "80%",
    minHeight: 48,
  },
  submitButtonDisabled: {
    backgroundColor: "#6EE7B7",
  },
  submitButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
