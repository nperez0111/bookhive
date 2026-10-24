import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookActionCard } from "@/components/BookActionCard";
import { CommentsSection } from "@/components/CommentsSection";
import { ReadingHistory } from "@/components/ReadingHistory";
import { DeleteConfirmationModal } from "@/components/DeleteConfirmationModal";
import { FadeInImage } from "@/components/FadeInImage";
import { ListItem } from "@/components/ListItem";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { StarDisplay } from "@/components/StarDisplay";
import { StatusSelectionModal } from "@/components/StatusSelectionModal";
import { ThemedText } from "@/components/ThemedText";
import { UserBlock } from "@/components/UserBlock";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useBookInfo, useDeleteBook, useUpdateBook } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { formatAuthors } from "@/utils/personalLibrary";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  ImageBackground,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp, LinearTransition } from "react-native-reanimated";
import type { BookProgress, HiveId } from "../../../../src/types";
import { type BookStatus } from "../../../constants/index";

import { AddToListSheet } from "@/components/AddToListSheet";
import { HtmlToText } from "@/utils/htmlToText";
import { formatDistanceToNow } from "date-fns";
import { calculatePercentFromProgressValues } from "@/utils/calculatePercentFromProgressValues";

function progressToDraft(progress: BookProgress | undefined) {
  return {
    currentPageInput: progress?.currentPage?.toString() ?? "",
    totalPagesInput: progress?.totalPages?.toString() ?? "",
    currentChapterInput: progress?.currentChapter?.toString() ?? "",
    totalChaptersInput: progress?.totalChapters?.toString() ?? "",
    manualPercentInput: progress?.percent?.toString() ?? null,
  };
}

type MetricField = Exclude<keyof ReturnType<typeof progressToDraft>, "manualPercentInput">;
const metricRows = [
  [
    { field: "currentPageInput", label: "Pages read", placeholder: "Current" },
    { field: "totalPagesInput", label: "Total pages", placeholder: "Total" },
  ],
  [
    { field: "currentChapterInput", label: "Chapters read", placeholder: "Current" },
    { field: "totalChaptersInput", label: "Total chapters", placeholder: "Total" },
  ],
] as const satisfies readonly (readonly {
  field: MetricField;
  label: string;
  placeholder: string;
}[])[];

function BookInfoContent({ hiveId, fromStatus }: { hiveId: HiveId; fromStatus?: string }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const [modalVisible, setModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [addToListVisible, setAddToListVisible] = useState(false);
  // null is untouched; an empty string is an intentional review deletion.
  const [userReviewText, setUserReviewText] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const bottom = useBottomTabOverflow();

  const bookQuery = useBookInfo(hiveId);
  const bookData = bookQuery.data;
  const storedProgress = bookData?.bookProgress;
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressSuccess, setProgressSuccess] = useState<string | null>(null);
  const [isProgressSaving, setIsProgressSaving] = useState(false);
  const progressKey = JSON.stringify(storedProgress ?? null);
  const [draft, setDraft] = useState(() => ({
    sourceKey: progressKey,
    fields: progressToDraft(storedProgress),
  }));
  const {
    currentPageInput,
    totalPagesInput,
    currentChapterInput,
    totalChaptersInput,
    manualPercentInput,
  } = draft.fields;

  // Reconcile replaced server progress before painting, not in a cascading effect.
  // Unrelated ownership/review changes must not erase an in-progress draft.
  if (draft.sourceKey !== progressKey) {
    setDraft({ sourceKey: progressKey, fields: progressToDraft(storedProgress) });
  }

  useEffect(() => {
    if (!progressSuccess) return;
    const timer = setTimeout(() => setProgressSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [progressSuccess]);

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

  const percentInput = manualPercentInput ?? (autoPercent !== null ? String(autoPercent) : "");
  const changeMetric = (field: MetricField, text: string) =>
    setDraft((old) => ({
      ...old,
      fields: { ...old.fields, [field]: text, manualPercentInput: null },
    }));

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
  const isBusy = updateBook.isPending || deleteBook.isPending;
  const saveBook = async (updates: Parameters<typeof updateBook.mutateAsync>[0]) => {
    if (deleteBook.isPending) return false;
    setMutationError(null);
    try {
      await updateBook.mutateAsync(updates);
      return true;
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Could not save changes. Please try again.",
      );
      return false;
    }
  };

  const handleOwnedToggle = async () => {
    await saveBook({ hiveId, owned: !bookData?.owned });
  };

  const handleStatusUpdate = async (status: BookStatus) => {
    await saveBook({ hiveId, status: status ?? "" });
    // The persistent error is on the page, so don't leave it hidden behind the picker.
    setModalVisible(false);
  };

  const handleAddReview = async () => {
    if (userReviewText === null) return;
    if (await saveBook({ hiveId, review: userReviewText })) {
      setUserReviewText(null);
    }
  };

  const handleRatingUpdate = async (newRating: number) => {
    await saveBook({
      hiveId: hiveId,
      stars: newRating,
    });
  };

  const handleSaveProgress = async () => {
    if (isBusy) return;
    setProgressError(null);
    setProgressSuccess(null);
    for (const [label, value] of [
      ["Pages read", currentPageInput],
      ["Total pages", totalPagesInput],
      ["Chapters read", currentChapterInput],
      ["Total chapters", totalChaptersInput],
    ]) {
      if (value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 1)) {
        setProgressError(`${label} must be a positive whole number.`);
        return;
      }
    }
    if (
      percentInput.trim() &&
      (!Number.isFinite(Number(percentInput)) ||
        Number(percentInput) < 0 ||
        Number(percentInput) > 100)
    ) {
      setProgressError("Percent must be between 0 and 100.");
      return;
    }
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

    if (Object.keys(payload).length === 1) {
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
    } catch (error) {
      console.error("Failed to save progress:", error);
      setProgressError("Failed to save progress.");
    } finally {
      setIsProgressSaving(false);
    }
  };

  const handleStartedAtUpdate = async (date: string | null) => {
    await saveBook({
      hiveId: hiveId,
      startedAt: date ?? "",
    });
  };

  const handleFinishedAtUpdate = async (date: string | null) => {
    await saveBook({
      hiveId: hiveId,
      finishedAt: date ?? "",
    });
  };

  const handleDeleteBook = async () => {
    if (isBusy) return;
    setMutationError(null);
    try {
      await deleteBook.mutateAsync({ hiveId });
      setUserReviewText(null);
      setDeleteModalVisible(false);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Could not delete book. Please try again.");
    }
  };

  const handleUserPress = (userDid: string) => {
    router.push(`/profile/${userDid}`);
  };

  const handleReplyClick = (commentId: string, replyFormRef: React.RefObject<View | null>) => {
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

  const handleShare = () => {
    const shareUrl = `${getBaseUrl()}/books/${hiveId}`;
    const blueskyText = `Check out "${book.title}" by ${formatAuthors(book.authors)} on BookHive!\n\n${shareUrl}`;
    const blueskyUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(blueskyText)}`;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Share via...", "Post to Bluesky"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            void Share.share({ url: shareUrl, title: book.title });
          } else if (buttonIndex === 2) {
            void Linking.openURL(blueskyUrl);
          }
        },
      );
    } else {
      // On Android, show native share directly (no ActionSheetIOS)
      void Share.share({ message: `${book.title}\n${shareUrl}`, title: book.title });
    }
  };

  const genres = useMemo(() => {
    const bookGenres = bookQuery.data?.book.genres;
    if (!bookGenres) return [];
    if (Array.isArray(bookGenres)) return bookGenres;
    try {
      return JSON.parse(bookGenres as string) as string[];
    } catch {
      return [];
    }
  }, [bookQuery.data?.book.genres]);

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

  const { book, reviews: _reviews, comments: _apiComments, ...userBook } = bookQuery.data!;
  const activity = bookQuery.data?.activity ?? [];
  const rating = book.rating ? book.rating / 1000 : 0;
  const status = (userBook.status ?? null) as BookStatus | null;
  const review = userReviewText ?? userBook.review ?? "";
  const hasTracking = Boolean(
    userBook.createdAt ||
    userBook.status ||
    userBook.stars ||
    userBook.review ||
    userBook.owned ||
    userBook.startedAt ||
    userBook.finishedAt ||
    userBook.bookProgress ||
    userBook.previousReads?.length,
  );
  const existingProgress = (userBook.bookProgress as BookProgress | undefined) ?? undefined;
  const percentDisplay =
    existingProgress?.percent ?? (autoPercent !== null ? autoPercent : undefined);
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
        existingProgress.totalChapters ? `/${existingProgress.totalChapters}` : ""
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
    <View style={[styles.mainContainer, { backgroundColor, paddingBottom: bottom }]}>
      {/* Back Navigation Header */}
      <BackNavigationHeader
        title={book.title}
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
                colorScheme === "dark" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.7)",
            },
          ]}
        />
      </ImageBackground>

      <ScrollView ref={scrollViewRef} style={styles.container} showsVerticalScrollIndicator={false}>
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
                style={[styles.title, { color: colorScheme === "dark" ? "white" : colors.text }]}
              >
                {book.title}
              </ThemedText>
              <ThemedText
                style={[styles.author, { color: colorScheme === "dark" ? "#E5E7EB" : colors.icon }]}
              >
                {formatAuthors(book.authors)}
              </ThemedText>

              {/* Rating Display */}
              {book.rating && book.ratingsCount && (
                <View style={styles.ratingDisplay}>
                  <StarDisplay rating={Math.round(rating * 2)} size="md" />
                  <ThemedText
                    style={[
                      styles.ratingsCount,
                      {
                        color: colorScheme === "dark" ? "#9CA3AF" : colors.icon,
                        marginLeft: 6,
                      },
                    ]}
                  >
                    {rating.toFixed(1)} ({book.ratingsCount.toLocaleString()})
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
                    colorScheme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
                  borderColor:
                    colorScheme === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)",
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
                    colorScheme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
                  borderColor:
                    colorScheme === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)",
                },
              ]}
              onPress={() => setAddToListVisible(true)}
            >
              <Ionicons
                name="list-outline"
                size={20}
                color={colorScheme === "dark" ? "white" : colors.text}
              />
              <ThemedText
                style={[
                  styles.actionButtonText,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Add to List
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

          {/* Genre Chips */}
          {genres.length > 0 && (
            <Animated.View
              style={styles.genreSection}
              entering={FadeInDown.delay(115).duration(220)}
              layout={LinearTransition.springify().damping(18).stiffness(180)}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.genreScroll}
              >
                {genres.map((genre) => (
                  <Pressable
                    key={genre}
                    style={[
                      styles.genreChip,
                      {
                        backgroundColor:
                          colorScheme === "dark"
                            ? "rgba(251, 191, 36, 0.15)"
                            : "rgba(217, 119, 6, 0.1)",
                        borderColor:
                          colorScheme === "dark"
                            ? "rgba(251, 191, 36, 0.3)"
                            : "rgba(217, 119, 6, 0.2)",
                      },
                    ]}
                    onPress={() =>
                      router.push(`/explore/genres/${encodeURIComponent(genre)}` as any)
                    }
                  >
                    <ThemedText
                      style={[styles.genreChipText, { color: colors.primary }]}
                      type="caption"
                    >
                      {genre}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* Who's Reading */}
          {activity.length > 0 && (
            <Animated.View
              style={styles.whoIsReadingSection}
              entering={FadeInDown.delay(120).duration(220)}
              layout={LinearTransition.springify().damping(18).stiffness(180)}
            >
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Who&apos;s Reading This ({activity.length})
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.whoIsReadingScroll}
              >
                {activity.map((item, idx) => {
                  const userDid = (item as any).userDid as string | undefined;
                  const userHandle = (item as any).userHandle as string | undefined;
                  return (
                    <UserBlock
                      key={`reader-${userDid ?? idx}`}
                      handle={userHandle ?? userDid ?? "user"}
                      avatar={
                        userHandle ? `${getBaseUrl()}/profile/${userHandle}/image` : undefined
                      }
                      size="sm"
                      onPress={userDid ? () => handleUserPress(userDid) : undefined}
                      style={styles.whoIsReadingItem}
                    />
                  );
                })}
              </ScrollView>
            </Animated.View>
          )}

          {/* Interactive Book Actions */}
          <Animated.View
            style={styles.actionsContainer}
            entering={FadeInDown.delay(140).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            {mutationError && (
              <ThemedText
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.progressError}
              >
                {mutationError}
              </ThemedText>
            )}
            <BookActionCard
              type="status"
              title="Reading Status"
              icon="bookmark-outline"
              status={status}
              onStatusPress={() => {
                if (!isBusy) setModalVisible(true);
              }}
              isPending={isBusy}
              rightAccessory={
                // Only show delete button if user has this book in their library
                hasTracking ? (
                  <Pressable
                    onPress={() => setDeleteModalVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete book tracking"
                    disabled={isBusy}
                    style={{
                      minWidth: 40,
                      minHeight: 40,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
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
            {status && (
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => saveBook({ hiveId, status: "" })}
                style={{ minHeight: 40, justifyContent: "center" }}
              >
                <ThemedText>Clear reading status</ThemedText>
              </Pressable>
            )}

            {/* Owned toggle */}
            <Pressable
              onPress={handleOwnedToggle}
              accessibilityRole="switch"
              accessibilityLabel="Own this book"
              accessibilityState={{ checked: Boolean(userBook.owned), disabled: isBusy }}
              disabled={isBusy}
              style={[
                styles.ownedToggle,
                {
                  backgroundColor: userBook.owned
                    ? colors.primary
                    : colorScheme === "dark"
                      ? "#1f2937"
                      : "#f3f4f6",
                  opacity: isBusy ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                name={userBook.owned ? "book" : "book-outline"}
                size={18}
                color={userBook.owned ? "#fff" : colors.text}
              />
              <ThemedText
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: userBook.owned ? "#fff" : colors.text,
                  marginLeft: 6,
                }}
              >
                {userBook.owned ? "Owned" : "Own"}
              </ThemedText>
            </Pressable>

            {/* Only show dates card if user has this book in their library */}
            {hasTracking && (
              <BookActionCard
                type="dates"
                title="Reading Dates"
                icon="calendar-outline"
                startedAt={userBook.startedAt}
                finishedAt={userBook.finishedAt}
                onStartedAtChange={handleStartedAtUpdate}
                onFinishedAtChange={handleFinishedAtUpdate}
                isPending={isBusy}
              />
            )}

            <BookActionCard
              type="rating"
              title={userBook.stars ? `Your Rating: ${userBook.stars / 2}/5` : "Rate this book"}
              icon="star-outline"
              rating={userBook.stars}
              onRatingChange={handleRatingUpdate}
              isPending={isBusy}
            />

            <BookActionCard
              type="review"
              title={userBook.review ? "Your Review" : "Write a review"}
              icon="chatbubble-outline"
              review={userBook.review}
              onReviewSave={handleAddReview}
              isPending={isBusy}
              reviewText={review}
              onReviewTextChange={setUserReviewText}
            />
          </Animated.View>

          <ReadingHistory
            previousReads={userBook.previousReads}
            progressHistory={userBook.progressHistory}
          />
          {!!userBook.shelves?.length && (
            <View style={{ gap: 8, marginBottom: 24 }}>
              <ThemedText accessibilityRole="header" type="heading">
                On public shelves
              </ThemedText>
              {userBook.shelves.map((shelf) => (
                <Pressable
                  key={shelf.uri}
                  accessibilityRole="button"
                  accessibilityLabel={`View public shelf ${shelf.name}`}
                  onPress={() =>
                    router.push({
                      pathname: "/lists/[uri]",
                      params: { uri: encodeURIComponent(shelf.uri) },
                    })
                  }
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <ThemedText>{shelf.name}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          <Animated.View
            style={[
              styles.progressCard,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
                shadowColor: colors.shadowLight,
              },
            ]}
            entering={FadeInDown.delay(130).duration(220)}
            layout={LinearTransition.springify().damping(18).stiffness(180)}
          >
            <View style={styles.progressHeader}>
              <ThemedText style={styles.progressTitle}>Reading Progress</ThemedText>
              {percentDisplay !== undefined && (
                <ThemedText style={styles.progressPercent}>{percentDisplay}% complete</ThemedText>
              )}
            </View>
            {progressSummary && (
              <ThemedText style={styles.progressSubtitle}>{progressSummary}</ThemedText>
            )}
            {metricRows.map((row) => (
              <View key={row[0].field} style={styles.progressRow}>
                {row.map(({ field, label, placeholder }) => (
                  <View key={field} style={styles.progressField}>
                    <ThemedText style={styles.progressLabel}>{label}</ThemedText>
                    <TextInput
                      accessibilityLabel={label}
                      value={draft.fields[field]}
                      editable={!isBusy}
                      onChangeText={(text) => changeMetric(field, text)}
                      keyboardType="numeric"
                      placeholder={placeholder}
                      placeholderTextColor={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
                      style={[
                        styles.progressInput,
                        { color: colorScheme === "dark" ? "#fff" : "#111" },
                      ]}
                    />
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.progressField}>
              <ThemedText style={styles.progressLabel}>Percent</ThemedText>
              <TextInput
                value={percentInput}
                editable={!isBusy}
                onChangeText={(text) =>
                  setDraft((old) => ({
                    ...old,
                    fields: { ...old.fields, manualPercentInput: text },
                  }))
                }
                keyboardType="numeric"
                placeholder="Auto-calculated"
                placeholderTextColor={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
                style={[styles.progressInput, { color: colorScheme === "dark" ? "#fff" : "#111" }]}
              />
            </View>
            <ThemedText style={styles.progressHint}>
              Percent auto-updates when pages or chapters change.
            </ThemedText>
            {progressError && <ThemedText style={styles.progressError}>{progressError}</ThemedText>}
            {progressSuccess && (
              <ThemedText style={styles.progressSuccess}>{progressSuccess}</ThemedText>
            )}
            <View style={styles.progressButtonContainer}>
              <Pressable
                style={[styles.progressButton, isProgressSaving && styles.progressButtonDisabled]}
                onPress={handleSaveProgress}
                disabled={isProgressSaving || isBusy}
              >
                {isProgressSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.progressButtonText}>Save progress</ThemedText>
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
                  const userHandle = (item as any).userHandle as string | undefined;
                  const title = `@${userHandle ?? userDid ?? "user"}`;
                  const subtitle = `${t.charAt(0).toUpperCase()}${t.slice(1)} · ${new Date(item.createdAt).toLocaleDateString()}`;
                  return (
                    <ListItem
                      key={`${item.hiveId}-${userDid ?? idx}-${item.createdAt}`}
                      icon={iconName}
                      avatarUri={
                        userHandle ? `${getBaseUrl()}/profile/${userHandle}/image` : undefined
                      }
                      title={title}
                      subtitle={subtitle}
                      onPress={userDid ? () => handleUserPress(userDid) : undefined}
                    />
                  );
                })}
              </View>
            )}
          </Animated.View>

          <StatusSelectionModal
            visible={modalVisible}
            onClose={() => {
              if (!isBusy) setModalVisible(false);
            }}
            currentStatus={status}
            onStatusSelect={handleStatusUpdate}
            isPending={isBusy}
          />

          {/* Only render delete modal if user has the book in their library */}
          {(hasTracking || deleteModalVisible) && (
            <DeleteConfirmationModal
              visible={deleteModalVisible}
              onClose={() => {
                if (!deleteBook.isPending) setDeleteModalVisible(false);
              }}
              onConfirm={handleDeleteBook}
              title="Delete Book"
              message={
                mutationError ??
                "Are you sure you want to delete this book? This action cannot be undone."
              }
              isPending={isBusy}
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

          <AddToListSheet
            visible={addToListVisible}
            onClose={() => setAddToListVisible(false)}
            hiveId={hiveId}
          />
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
  genreSection: {
    marginBottom: 20,
  },
  genreScroll: {
    gap: 8,
  },
  genreChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  genreChipText: {
    fontWeight: "500",
  },
  whoIsReadingSection: {
    marginBottom: 24,
  },
  whoIsReadingScroll: {
    gap: 16,
    paddingVertical: 4,
  },
  whoIsReadingItem: {
    minWidth: 120,
  },
  actionsContainer: {
    marginBottom: 24,
    gap: 16,
  },
  ownedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
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
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
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
