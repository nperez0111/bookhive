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
  ImageBackground,
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
import {
  CommentsSection,
  type CommentItem,
} from "@/components/CommentsSection";

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
  const backgroundColor = useThemeColor({}, "background");
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<BookStatus | null>(null);
  const [userReviewText, setUserReviewText] = useState("");

  const bookQuery = useBookInfo(hiveId);

  // Combine comments and reviews from the API response
  const comments = bookQuery.data
    ? [
        ...bookQuery.data.comments.map((comment, index) => ({
          ...comment,
          id: `comment-${index}`,
        })),
        ...bookQuery.data.reviews.map((review, index) => ({
          ...review,
          id: `review-${index}`,
        })),
      ]
    : [];
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
      return;
    }
    try {
      await updateBook.mutateAsync({
        hiveId: hiveId,
        review: userReviewText,
      });
      setUserReviewText("");
    } catch (e) {
      console.error("Failed to add review:", e);
    }
  };

  const handleRatingUpdate = async (newRating: number) => {
    await updateBook.mutateAsync({
      hiveId: hiveId,
      stars: newRating,
    });
  };

  // Comment interaction handlers
  const handleLikeComment = (commentId: string) => {
    // TODO: Implement like functionality
    console.log("Like comment:", commentId);
  };

  const handleCommentPress = (commentId: string) => {
    // TODO: Implement comment thread view
    console.log("Open comment thread:", commentId);
  };

  const handleUserPress = (userDid: string) => {
    // TODO: Navigate to user profile
    console.log("Open user profile:", userDid);
  };

  const handleViewOnGoodreads = () => {
    if (bookQuery.data?.book.sourceUrl) {
      Linking.openURL(bookQuery.data.book.sourceUrl);
    }
  };

  if (bookQuery.isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color="#FBBF24" />
      </View>
    );
  }

  if (bookQuery.error) {
    return (
      <View style={[styles.errorContainer, { backgroundColor }]}>
        <ThemedText>Error: {bookQuery.error.message}</ThemedText>
      </View>
    );
  }

  const { book, reviews, comments: apiComments, ...userBook } = bookQuery.data!;
  const rating = book.rating ? book.rating / 1000 : 0;
  const status = (userBook.status ?? selectedStatus) as BookStatus | null;
  const review = userReviewText || userBook.review;

  console.log(bookQuery.data);

  return (
    <View style={[styles.mainContainer, { backgroundColor }]}>
      {/* Blurred Background */}
      <ImageBackground
        source={{
          uri: `${getBaseUrl()}/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
        }}
        style={styles.backgroundImage}
        blurRadius={20}
      >
        <View style={styles.backgroundOverlay} />
      </ImageBackground>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          {/* Book Cover and Info Section */}
          <View style={styles.bookSection}>
            <View style={styles.coverContainer}>
              <Image
                source={{
                  uri: `${getBaseUrl()}/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
                }}
                style={styles.cover}
                resizeMode="cover"
              />
            </View>

            <View style={styles.bookInfo}>
              <ThemedText style={styles.title}>{book.title}</ThemedText>
              <ThemedText style={styles.author}>
                {book.authors.split("\t").join(", ")}
              </ThemedText>

              {/* Rating Display */}
              {book.rating && book.ratingsCount && (
                <View style={styles.ratingDisplay}>
                  <ThemedText style={styles.ratingText}>
                    {rating.toFixed(1)} ★
                  </ThemedText>
                  <ThemedText style={styles.ratingsCount}>
                    {book.ratingsCount.toLocaleString()} ratings
                  </ThemedText>
                </View>
              )}
            </View>
          </View>

          <View style={styles.actionButtons}>
            {/* <Pressable
              style={styles.actionButton}
              onPress={() => setModalVisible(true)}
            >
              <Ionicons name="add" size={20} color="white" />
              <ThemedText style={styles.actionButtonText}>Add</ThemedText>
            </Pressable>

            <Pressable style={styles.actionButton} onPress={handleShare}>
              <Ionicons name="share-outline" size={20} color="white" />
              <ThemedText style={styles.actionButtonText}>Share</ThemedText>
            </Pressable> */}

            <Pressable
              style={styles.actionButton}
              onPress={handleViewOnGoodreads}
            >
              <Ionicons name="share-outline" size={20} color="white" />
              <ThemedText style={styles.actionButtonText}>Goodreads</ThemedText>
            </Pressable>
          </View>

          {/* Description */}
          <View style={styles.descriptionSection}>
            <ThemedText style={styles.sectionTitle}>Description</ThemedText>
            <ThemedText style={[styles.description]}>
              {decode(book.description || "No description available")}
            </ThemedText>
          </View>

          {/* Rating Input Section */}
          <View style={styles.ratingSection}>
            <ThemedText style={styles.sectionTitle}>
              {userBook.stars ? `You rated: ${userBook.stars / 2}` : "Rating"}
            </ThemedText>
            <StarRating
              rating={userBook.stars}
              onRate={handleRatingUpdate}
              disabled={updateBook.isPending}
              starSize={28}
            />
            <ThemedText style={styles.sectionTitle}>
              {userBook.review ? "Your Review" : "Review"}
            </ThemedText>
            <TextInput
              style={[styles.reviewInput, { color: textColor }]}
              placeholder="What did you think?"
              value={review}
              onChangeText={setUserReviewText}
              multiline
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* Comments Section */}
          <CommentsSection
            comments={comments}
            onLikeComment={handleLikeComment}
            onCommentPress={handleCommentPress}
            onUserPress={handleUserPress}
          />
        </View>
      </ScrollView>

      {/* Status Selection Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
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
                color="#FBBF24"
                style={{ paddingVertical: 20 }}
              />
            ) : (
              <FlatList
                data={STATUS_OPTIONS}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleStatusUpdate(item)}
                  >
                    <ThemedText
                      style={styles.modalOptionText}
                      type={status === item ? "defaultSemiBold" : "default"}
                      themeSource={status === item ? "tint" : "text"}
                    >
                      {BOOK_STATUS_MAP[item]}
                    </ThemedText>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            )}
          </ThemedView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    position: "relative",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  backgroundImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backgroundOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
  },
  searchPlaceholder: {
    marginLeft: 8,
    color: "#9CA3AF",
    fontSize: 16,
  },
  notificationButton: {
    padding: 8,
  },
  container: {
    flex: 1,
    paddingTop: 36,
  },
  contentContainer: {
    padding: 16,
    paddingTop: 0,
  },
  bookSection: {
    flexDirection: "row",
    marginBottom: 24,
  },
  coverContainer: {
    marginRight: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cover: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  bookInfo: {
    flex: 1,
    justifyContent: "center",
  },
  seriesLabel: {
    fontSize: 12,
    color: "#9CA3AF",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginBottom: 4,
    lineHeight: 24,
  },
  author: {
    fontSize: 16,
    color: "#E5E7EB",
    marginBottom: 4,
  },
  publicationInfo: {
    fontSize: 14,
    color: "#9CA3AF",
    marginBottom: 8,
  },
  ratingDisplay: {
    flexDirection: "row",
    alignItems: "center",
  },
  ratingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FBBF24",
    marginRight: 8,
  },
  ratingsCount: {
    fontSize: 14,
    color: "#9CA3AF",
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  actionButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  descriptionSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "white",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: "#E5E7EB",
    marginBottom: 8,
  },
  descriptionCollapsed: {
    // This style is used to ensure proper text truncation
  },
  readMoreText: {
    color: "#FBBF24",
    fontSize: 14,
    fontWeight: "500",
  },
  ratingSection: {
    marginBottom: 24,
  },
  reviewInput: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginTop: 16,
    minHeight: 80,
    textAlignVertical: "top",
    color: "white",
  },
  allRatingsSection: {
    marginBottom: 24,
  },
  ratingsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  ratingDistribution: {
    gap: 8,
  },
  ratingBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  ratingLabel: {
    width: 30,
    fontSize: 14,
    color: "#9CA3AF",
  },
  barContainer: {
    flex: 1,
    height: 8,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 4,
    marginHorizontal: 12,
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    backgroundColor: "#FBBF24",
    borderRadius: 4,
  },
  ratingPercentage: {
    width: 35,
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "right",
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalView: {
    margin: 20,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "stretch",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: "80%",
    maxHeight: "50%",
  },
  modalOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  modalOptionText: {
    fontSize: 16,
    textAlign: "center",
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: 16,
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
});
