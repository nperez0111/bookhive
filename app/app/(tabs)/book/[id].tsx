import { ThemedText } from "@/components/ThemedText";
import { useBookInfo, useUpdateBook } from "@/hooks/useBookhiveQuery";
import { useLocalSearchParams, router } from "expo-router";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  Linking,
  ImageBackground,
} from "react-native";
import type { HiveId } from "../../../../src/types";
import { type BookStatus } from "../../../constants/index";
import { decode } from "html-entities";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { getBaseUrl } from "@/context/auth";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import {
  CommentsSection,
  type CommentItem,
} from "@/components/CommentsSection";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { BookActionCard } from "@/components/BookActionCard";
import { StatusSelectionModal } from "@/components/StatusSelectionModal";

export default function BookInfo() {
  const { id: hiveId } = useLocalSearchParams<{ id: HiveId }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
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

  const handleStatusUpdate = async (status: BookStatus) => {
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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (bookQuery.error) {
    return (
      <QueryErrorHandler
        error={bookQuery.error}
        onRetry={() => bookQuery.refetch()}
        onGoBack={() => router.back()}
        showRetryButton={true}
        showGoBackButton={true}
      />
    );
  }

  const { book, reviews, comments: apiComments, ...userBook } = bookQuery.data!;
  const rating = book.rating ? book.rating / 1000 : 0;
  const status = (userBook.status ?? selectedStatus) as BookStatus | null;
  const review = userReviewText || userBook.review;

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
        <View
          style={[
            styles.backgroundOverlay,
            {
              backgroundColor:
                colorScheme === "dark"
                  ? "rgba(0, 0, 0, 0.7)"
                  : "rgba(255, 255, 255, 0.7)",
            },
          ]}
        />
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
              <ThemedText
                style={[
                  styles.title,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                {book.title}
              </ThemedText>
              <ThemedText
                style={[
                  styles.author,
                  { color: colorScheme === "dark" ? "#E5E7EB" : colors.icon },
                ]}
              >
                {book.authors.split("\t").join(", ")}
              </ThemedText>

              {/* Rating Display */}
              {book.rating && book.ratingsCount && (
                <View style={styles.ratingDisplay}>
                  <ThemedText
                    style={[styles.ratingText, { color: colors.primary }]}
                  >
                    {rating.toFixed(1)} ★
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.ratingsCount,
                      {
                        color: colorScheme === "dark" ? "#9CA3AF" : colors.icon,
                      },
                    ]}
                  >
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
              style={[
                styles.actionButton,
                {
                  backgroundColor:
                    colorScheme === "dark"
                      ? "rgba(255, 255, 255, 0.1)"
                      : "rgba(0, 0, 0, 0.1)",
                  borderColor:
                    colorScheme === "dark"
                      ? "rgba(255, 255, 255, 0.2)"
                      : "rgba(0, 0, 0, 0.2)",
                },
              ]}
              onPress={handleViewOnGoodreads}
            >
              <Ionicons
                name="share-outline"
                size={20}
                color={colorScheme === "dark" ? "white" : colors.text}
              />
              <ThemedText
                style={[
                  styles.actionButtonText,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Goodreads
              </ThemedText>
            </Pressable>
          </View>

          {/* Description */}
          <View style={styles.descriptionSection}>
            <ThemedText
              style={[
                styles.sectionTitle,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
            >
              Description
            </ThemedText>
            <ThemedText
              style={[
                styles.description,
                { color: colorScheme === "dark" ? "#E5E7EB" : colors.text },
              ]}
            >
              {decode(book.description || "No description available")}
            </ThemedText>
          </View>

          {/* Interactive Book Actions */}
          <View style={styles.actionsContainer}>
            <BookActionCard
              type="status"
              title="Reading Status"
              icon="bookmark-outline"
              status={status}
              onStatusPress={() => setModalVisible(true)}
            />

            <BookActionCard
              type="rating"
              title={
                userBook.stars
                  ? `Your Rating: ${userBook.stars / 2}/5`
                  : "Rate this book"
              }
              icon="star-outline"
              rating={userBook.stars}
              onRatingChange={handleRatingUpdate}
              isPending={updateBook.isPending}
            />

            <BookActionCard
              type="review"
              title={userBook.review ? "Your Review" : "Write a review"}
              icon="chatbubble-outline"
              review={userBook.review}
              onReviewSave={handleAddReview}
              isPending={updateBook.isPending}
              reviewText={review}
              onReviewTextChange={setUserReviewText}
            />
          </View>

          <StatusSelectionModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            currentStatus={status}
            onStatusSelect={handleStatusUpdate}
            isPending={updateBook.isPending}
          />

          <CommentsSection
            comments={comments}
            onCommentPress={handleCommentPress}
            onUserPress={handleUserPress}
          />
        </View>
      </ScrollView>
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
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
    lineHeight: 24,
  },
  author: {
    fontSize: 16,
    marginBottom: 4,
  },
  publicationInfo: {
    fontSize: 14,
    marginBottom: 8,
  },
  ratingDisplay: {
    flexDirection: "row",
    alignItems: "center",
  },
  ratingText: {
    fontSize: 16,
    fontWeight: "600",
    marginRight: 8,
  },
  ratingsCount: {
    fontSize: 14,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  descriptionSection: {
    marginBottom: 24,
  },
  actionsContainer: {
    marginBottom: 24,
    gap: 16,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 8,
  },
  descriptionCollapsed: {
    // This style is used to ensure proper text truncation
  },
  readMoreText: {
    fontSize: 14,
    fontWeight: "500",
  },
  ratingSection: {
    marginBottom: 24,
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
});
