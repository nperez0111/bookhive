import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookActionCard } from "@/components/BookActionCard";
import { CommentsSection } from "@/components/CommentsSection";
import { DeleteConfirmationModal } from "@/components/DeleteConfirmationModal";
import { FadeInImage } from "@/components/FadeInImage";
import { ListItem } from "@/components/ListItem";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { StatusSelectionModal } from "@/components/StatusSelectionModal";
import { ThemedText } from "@/components/ThemedText";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import {
  useBookInfo,
  useDeleteBook,
  useUpdateBook,
} from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  LinearTransition,
} from "react-native-reanimated";
import type { HiveId } from "../../../../src/types";
import { type BookStatus } from "../../../constants/index";

import { HtmlToText } from "@/utils/htmlToText";
import { formatDistanceToNow } from "date-fns";
import type { BookProgress } from "../../../../src/types";
import { calculatePercentFromProgressValues } from "@/utils/calculatePercentFromProgressValues";

function BookInfoContent({
  hiveId,
  fromStatus,
}: {
  hiveId: HiveId;
  fromStatus?: string;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const textColor = useThemeColor({}, "text");
  const backgroundColor = useThemeColor({}, "background");
  const [modalVisible, setModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<BookStatus | null>(null);
  const [userReviewText, setUserReviewText] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);
  const bottom = useBottomTabOverflow();

  const bookQuery = useBookInfo(hiveId);
  const bookData = bookQuery.data;
  const [currentPageInput, setCurrentPageInput] = useState("");
  const [totalPagesInput, setTotalPagesInput] = useState("");
  const [currentChapterInput, setCurrentChapterInput] = useState("");
  const [totalChaptersInput, setTotalChaptersInput] = useState("");
  const [percentInput, setPercentInput] = useState("");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressSuccess, setProgressSuccess] = useState<string | null>(null);
  const [isProgressSaving, setIsProgressSaving] = useState(false);
  const autoPercentRef = useRef(false);

  useEffect(() => {
    if (!bookData) {
      return;
    }
    const storedProgress = bookData.bookProgress ?? null;
    const meta =
      bookData.book?.meta &&
      (() => {
        try {
          return JSON.parse(bookData.book.meta as any);
        } catch {
          return null;
        }
      })();

    setCurrentPageInput(storedProgress?.currentPage?.toString() ?? "");
    setCurrentChapterInput(storedProgress?.currentChapter?.toString() ?? "");
    setTotalChaptersInput(storedProgress?.totalChapters?.toString() ?? "");
    setTotalPagesInput(
      storedProgress?.totalPages?.toString() ??
        (meta?.numPages ? String(meta.numPages) : ""),
    );

    const autoPercent = calculatePercentFromProgressValues({
      currentPage: storedProgress?.currentPage,
      totalPages: storedProgress?.totalPages,
      currentChapter: storedProgress?.currentChapter,
      totalChapters: storedProgress?.totalChapters,
    });
    setPercentInput(
      storedProgress?.percent !== undefined
        ? String(storedProgress.percent)
        : autoPercent !== null
          ? String(autoPercent)
          : "",
    );
  }, [bookData]);

  const parseNumberInput = (value: string) => {
    const parsed = Number(value === "" ? undefined : value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const currentPageValue = parseNumberInput(currentPageInput);
  const totalPagesValue = parseNumberInput(totalPagesInput);
  const currentChapterValue = parseNumberInput(currentChapterInput);
  const totalChaptersValue = parseNumberInput(totalChaptersInput);
  const autoPercent = calculatePercentFromProgressValues({
    currentPage: currentPageValue,
    totalPages: totalPagesValue,
    currentChapter: currentChapterValue,
    totalChapters: totalChaptersValue,
  });

  useEffect(() => {
    if (!autoPercentRef.current) {
      autoPercentRef.current = true;
      return;
    }
    if (autoPercent !== null) {
      setPercentInput(String(autoPercent));
    }
  }, [autoPercent]);

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
  const deleteBook = useDeleteBook();

  const handleStatusUpdate = async (status: BookStatus) => {
    let currentStatus = selectedStatus;
    setSelectedStatus(status);
    try {
      await updateBook.mutateAsync({
        hiveId: hiveId,
        status,
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

  const handleSaveProgress = async () => {
    setProgressError(null);
    setProgressSuccess(null);
    const payload: BookProgress = {
      updatedAt: new Date().toISOString(),
    };
    if (percentInput.trim()) {
      const percentValue = Number(percentInput);
      if (Number.isFinite(percentValue)) {
        payload.percent = Math.min(100, Math.max(0, Math.round(percentValue)));
      }
    }
    if (typeof currentPageValue === "number") {
      payload.currentPage = currentPageValue;
    }
    if (typeof totalPagesValue === "number") {
      payload.totalPages = totalPagesValue;
    }
    if (typeof currentChapterValue === "number") {
      payload.currentChapter = currentChapterValue;
    }
    if (typeof totalChaptersValue === "number") {
      payload.totalChapters = totalChaptersValue;
    }

    if (Object.keys(payload).length === 0) {
      setProgressError("Enter at least one progress metric before saving.");
      return;
    }

    try {
      setIsProgressSaving(true);
      await updateBook.mutateAsync({
        hiveId,
        bookProgress: payload,
      });
      setProgressSuccess("Progress saved");
      setTimeout(() => setProgressSuccess(null), 3000);
    } catch (error) {
      console.error("Failed to save progress:", error);
      setProgressError("Failed to save progress.");
    } finally {
      setIsProgressSaving(false);
    }
  };

  const handleStartedAtUpdate = async (date: string | null) => {
    await updateBook.mutateAsync({
      hiveId: hiveId,
      startedAt: date,
    });
  };

  const handleFinishedAtUpdate = async (date: string | null) => {
    await updateBook.mutateAsync({
      hiveId: hiveId,
      finishedAt: date,
    });
  };

  const handleDeleteBook = async () => {
    try {
      await deleteBook.mutateAsync({ hiveId });
      setSelectedStatus(null);
      setUserReviewText("");
      setDeleteModalVisible(false);
    } catch (e) {
      console.error("Failed to delete book:", e);
    }
  };

  const handleUserPress = (userDid: string) => {
    router.push(`/profile/${userDid}`);
  };

  const handleReplyClick = (
    commentId: string,
    replyFormRef: React.RefObject<View>,
  ) => {
    // Scroll to the reply form after a short delay to ensure it's rendered
    setTimeout(() => {
      if (replyFormRef.current && scrollViewRef.current) {
        replyFormRef.current.measureLayout(
          // @ts-ignore - measureLayout exists on View
          scrollViewRef.current,
          (x: number, y: number) => {
            scrollViewRef.current?.scrollTo({
              y: y - 100, // Offset to show some content above the reply form
              animated: true,
            });
          },
          () => {
            console.log("Could not measure reply form layout");
          },
        );
      }
    }, 100);
  };

  const handleViewOnGoodreads = () => {
    if (bookQuery.data?.book.sourceUrl) {
      Linking.openURL(bookQuery.data.book.sourceUrl);
    }
  };

  const handleShare = () => {
    const shareUrl = `${getBaseUrl()}/books/${hiveId}`;
    Share.share({
      url: shareUrl,
      title: book.title,
    });
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
  const activity = bookQuery.data?.activity ?? [];
  const rating = book.rating ? book.rating / 1000 : 0;
  const status = (userBook.status ?? selectedStatus) as BookStatus | null;
  const review = userReviewText || userBook.review;
  const existingProgress =
    (userBook.bookProgress as BookProgress | undefined) ?? undefined;
  const percentDisplay =
    existingProgress?.percent ??
    (autoPercent !== null ? autoPercent : undefined);
  const progressTicks: string[] = [];
  if (existingProgress?.currentPage) {
    progressTicks.push(
      `${existingProgress.currentPage}${
        existingProgress.totalPages ? `/${existingProgress.totalPages}` : ""
      } pages`,
    );
  }
  if (existingProgress?.currentChapter) {
    progressTicks.push(
      `${existingProgress.currentChapter}${
        existingProgress.totalChapters
          ? `/${existingProgress.totalChapters}`
          : ""
      } chapters`,
    );
  }
  const progressUpdatedAt = existingProgress?.updatedAt
    ? formatDistanceToNow(new Date(existingProgress.updatedAt), {
        addSuffix: true,
      })
    : null;
  const progressSummary =
    progressTicks.length || progressUpdatedAt
      ? `${progressTicks.join(" • ")}${
          progressTicks.length && progressUpdatedAt ? " • " : ""
        }${progressUpdatedAt ? `Updated ${progressUpdatedAt}` : ""}`
      : null;

  return (
    <View
      style={[styles.mainContainer, { backgroundColor, paddingBottom: bottom }]}
    >
      {/* Back Navigation Header */}
      <BackNavigationHeader
        title="Book Info"
        onBackPress={
          fromStatus
            ? () => {
                // Navigate back to the specific filtered books page
                router.push(`/books/${fromStatus}` as any);
              }
            : undefined
        }
      />

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

      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.contentContainer, { paddingBottom: 20 + bottom }]}>
          {/* Book Cover and Info Section */}
          <Animated.View
            style={styles.bookSection}
            entering={FadeInDown.delay(40).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <View style={styles.coverContainer}>
              <FadeInImage
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
          </Animated.View>

          <Animated.View
            style={styles.actionButtons}
            entering={FadeInDown.delay(80).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
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
              onPress={handleShare}
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
                Share
              </ThemedText>
            </Pressable>

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
          </Animated.View>

          {/* Description */}
          <Animated.View
            style={styles.descriptionSection}
            entering={FadeInDown.delay(110).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <ThemedText
              style={[
                styles.sectionTitle,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
            >
              Description
            </ThemedText>
            <HtmlToText
              html={book.description || "No description available"}
              style={[
                styles.description,
                { color: colorScheme === "dark" ? "#E5E7EB" : colors.text },
              ]}
            />
          </Animated.View>

          {/* Interactive Book Actions */}
          <Animated.View
            style={styles.actionsContainer}
            entering={FadeInDown.delay(140).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <BookActionCard
              type="status"
              title="Reading Status"
              icon="bookmark-outline"
              status={status}
              onStatusPress={() => setModalVisible(true)}
              rightAccessory={
                // Only show delete button if user has this book in their library
                userBook.status || userBook.stars || userBook.review ? (
                  <Pressable
                    onPress={() => setDeleteModalVisible(true)}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={colorScheme === "dark" ? "#ef4444" : "#991b1b"}
                    />
                  </Pressable>
                ) : null
              }
            />

            {/* Only show dates card if user has this book in their library */}
            {(userBook.status || userBook.stars || userBook.review) && (
              <BookActionCard
                type="dates"
                title="Reading Dates"
                icon="calendar-outline"
                startedAt={userBook.startedAt}
                finishedAt={userBook.finishedAt}
                onStartedAtChange={handleStartedAtUpdate}
                onFinishedAtChange={handleFinishedAtUpdate}
                isPending={updateBook.isPending}
              />
            )}

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
          </Animated.View>

          <Animated.View
            style={[
              styles.progressCard,
              {
                backgroundColor: colorScheme === "dark" ? "#111" : "#fffdf5",
              },
            ]}
            entering={FadeInDown.delay(130).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <View style={styles.progressHeader}>
              <ThemedText style={styles.progressTitle}>
                Reading Progress
              </ThemedText>
              {percentDisplay !== undefined && (
                <ThemedText style={styles.progressPercent}>
                  {percentDisplay}% complete
                </ThemedText>
              )}
            </View>
            {progressSummary && (
              <ThemedText style={styles.progressSubtitle}>
                {progressSummary}
              </ThemedText>
            )}
            <View style={styles.progressRow}>
              <View style={styles.progressField}>
                <ThemedText style={styles.progressLabel}>Pages read</ThemedText>
                <TextInput
                  value={currentPageInput}
                  onChangeText={setCurrentPageInput}
                  keyboardType="numeric"
                  placeholder="Current"
                  placeholderTextColor={
                    colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
                  }
                  style={[
                    styles.progressInput,
                    { color: colorScheme === "dark" ? "#fff" : "#111" },
                  ]}
                />
              </View>
              <View style={styles.progressField}>
                <ThemedText style={styles.progressLabel}>
                  Total pages
                </ThemedText>
                <TextInput
                  value={totalPagesInput}
                  onChangeText={setTotalPagesInput}
                  keyboardType="numeric"
                  placeholder="Total"
                  placeholderTextColor={
                    colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
                  }
                  style={[
                    styles.progressInput,
                    { color: colorScheme === "dark" ? "#fff" : "#111" },
                  ]}
                />
              </View>
            </View>
            <View style={styles.progressRow}>
              <View style={styles.progressField}>
                <ThemedText style={styles.progressLabel}>
                  Chapters read
                </ThemedText>
                <TextInput
                  value={currentChapterInput}
                  onChangeText={setCurrentChapterInput}
                  keyboardType="numeric"
                  placeholder="Current"
                  placeholderTextColor={
                    colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
                  }
                  style={[
                    styles.progressInput,
                    { color: colorScheme === "dark" ? "#fff" : "#111" },
                  ]}
                />
              </View>
              <View style={styles.progressField}>
                <ThemedText style={styles.progressLabel}>
                  Total chapters
                </ThemedText>
                <TextInput
                  value={totalChaptersInput}
                  onChangeText={setTotalChaptersInput}
                  keyboardType="numeric"
                  placeholder="Total"
                  placeholderTextColor={
                    colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
                  }
                  style={[
                    styles.progressInput,
                    { color: colorScheme === "dark" ? "#fff" : "#111" },
                  ]}
                />
              </View>
            </View>
            <View style={styles.progressField}>
              <ThemedText style={styles.progressLabel}>Percent</ThemedText>
              <TextInput
                value={percentInput}
                onChangeText={setPercentInput}
                keyboardType="numeric"
                placeholder="Auto-calculated"
                placeholderTextColor={
                  colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
                }
                style={[
                  styles.progressInput,
                  { color: colorScheme === "dark" ? "#fff" : "#111" },
                ]}
              />
            </View>
            <ThemedText style={styles.progressHint}>
              Percent auto-updates when pages or chapters change.
            </ThemedText>
            {progressError && (
              <ThemedText style={styles.progressError}>
                {progressError}
              </ThemedText>
            )}
            {progressSuccess && (
              <ThemedText style={styles.progressSuccess}>
                {progressSuccess}
              </ThemedText>
            )}
            <View style={styles.progressButtonContainer}>
              <Pressable
                style={[
                  styles.progressButton,
                  isProgressSaving && styles.progressButtonDisabled,
                ]}
                onPress={handleSaveProgress}
                disabled={isProgressSaving}
              >
                {isProgressSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.progressButtonText}>
                    Save progress
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </Animated.View>

          {/* Activity from other users */}
          <Animated.View
            style={styles.activitySection}
            entering={FadeInDown.delay(160).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <ThemedText
              style={[
                styles.sectionTitle,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
            >
              Activity
            </ThemedText>
            {activity.length === 0 ? (
              <ThemedText
                style={{
                  color: colorScheme === "dark" ? "#9CA3AF" : colors.icon,
                }}
                type="body"
              >
                No recent activity on this book
              </ThemedText>
            ) : (
              <View style={{ gap: 10 }}>
                {activity.map((item, idx) => {
                  const t = item.type;
                  const iconName =
                    t === "finished"
                      ? ("checkmark-circle-outline" as const)
                      : t === "review"
                        ? ("chatbubble-ellipses-outline" as const)
                        : ("book-outline" as const);
                  const userDid = (item as any).userDid as string | undefined;
                  const userHandle = (item as any).userHandle as
                    | string
                    | undefined;
                  const title = `@${userHandle ?? userDid ?? "user"}`;
                  const subtitle = `${t.charAt(0).toUpperCase()}${t.slice(1)} · ${new Date(item.createdAt).toLocaleDateString()}`;
                  return (
                    <ListItem
                      key={`${item.hiveId}-${userDid ?? idx}-${item.createdAt}`}
                      icon={iconName}
                      avatarUri={
                        userHandle
                          ? `${getBaseUrl()}/profile/${userHandle}/image`
                          : undefined
                      }
                      title={title}
                      subtitle={subtitle}
                      onPress={
                        userDid ? () => handleUserPress(userDid) : undefined
                      }
                    />
                  );
                })}
              </View>
            )}
          </Animated.View>

          <StatusSelectionModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            currentStatus={status}
            onStatusSelect={handleStatusUpdate}
            isPending={updateBook.isPending}
          />

          {/* Only render delete modal if user has the book in their library */}
          {(userBook.status || userBook.stars || userBook.review) && (
            <DeleteConfirmationModal
              visible={deleteModalVisible}
              onClose={() => setDeleteModalVisible(false)}
              onConfirm={handleDeleteBook}
              title="Delete Book"
              message="Are you sure you want to delete this book? This action cannot be undone."
              isPending={deleteBook.isPending}
            />
          )}

          <Animated.View
            entering={FadeInUp.delay(180).duration(240)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <CommentsSection
              comments={comments}
              hiveId={hiveId}
              onUserPress={handleUserPress}
              onReplyClick={handleReplyClick}
            />
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

export default function BookInfo() {
  const { id: hiveId, status: fromStatusParam } = useLocalSearchParams<{
    id: HiveId;
    status?: string;
  }>();
  return (
    <BookInfoContent
      key={(hiveId as string) ?? ""}
      hiveId={hiveId as HiveId}
      fromStatus={fromStatusParam}
    />
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
    paddingTop: 0, // Remove top padding since we have header now
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
  activitySection: {
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
  progressCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(156, 163, 175, 0.3)",
    padding: 16,
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  progressTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: "500",
    color: "#34D399",
  },
  progressSubtitle: {
    fontSize: 14,
    color: "#9CA3AF",
    marginTop: 6,
  },
  progressRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  progressField: {
    flex: 1,
    marginTop: 10,
  },
  progressLabel: {
    fontSize: 12,
    color: "#6B7280",
  },
  progressInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    fontSize: 16,
    backgroundColor: "transparent",
  },
  progressHint: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 10,
  },
  progressError: {
    fontSize: 12,
    color: "#F87171",
    marginTop: 6,
  },
  progressSuccess: {
    fontSize: 12,
    color: "#34D399",
    marginTop: 6,
  },
  progressButtonContainer: {
    marginTop: 12,
  },
  progressButton: {
    backgroundColor: "#FBBF24",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  progressButtonDisabled: {
    opacity: 0.6,
  },
  progressButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111",
  },
});
