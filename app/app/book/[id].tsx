import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { ReadingProgressCard } from "@/components/book-detail/ReadingProgressCard";
import { useReadingProgressDraft } from "@/components/book-detail/useReadingProgressDraft";
import { progressDraftPayload } from "@/components/book-detail/progressDraft";
import { useReviewDraft } from "@/components/book-detail/useReviewDraft";
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
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import type { HiveId } from "../../../src/types";
import { type BookStatus } from "@/constants/index";

import { AddToListSheet } from "@/components/AddToListSheet";
import { HtmlToText } from "@/utils/htmlToText";

function BookInfoContent({ hiveId, fromStatus }: { hiveId: HiveId; fromStatus?: string }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const [modalVisible, setModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [addToListVisible, setAddToListVisible] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [progressEditing, setProgressEditing] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const bottom = useBottomTabOverflow();

  const bookQuery = useBookInfo(hiveId);
  const bookData = bookQuery.data;
  const reviewDraft = useReviewDraft(bookData?.review);
  const storedProgress = bookData?.bookProgress;
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressSuccess, setProgressSuccess] = useState<string | null>(null);
  const [activeWrite, setActiveWrite] = useState<"book" | "progress" | "delete" | null>(null);
  const writeInFlight = useRef(false);
  const progressDraft = useReadingProgressDraft(storedProgress);

  useEffect(() => {
    if (!progressSuccess) return;
    const timer = setTimeout(() => setProgressSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [progressSuccess]);

  // Combine comments and reviews from the API response
  const comments = bookQuery.data
    ? [
        ...bookQuery.data.comments.map((comment) => ({
          ...comment,
          id:
            "uri" in comment && typeof comment.uri === "string" && comment.uri
              ? comment.uri
              : `comment:${JSON.stringify([comment.did, comment.createdAt, comment.parent?.uri, comment.comment])}`,
        })),
        ...bookQuery.data.reviews.map((review) => ({
          ...review,
          id:
            "uri" in review && typeof review.uri === "string" && review.uri
              ? review.uri
              : `review:${review.did}`,
        })),
      ]
    : [];
  const updateBook = useUpdateBook();
  const deleteBook = useDeleteBook();
  const isBusy = updateBook.isPending || deleteBook.isPending || activeWrite !== null;
  const saveBook = async (updates: Parameters<typeof updateBook.mutateAsync>[0]) => {
    if (isBusy || writeInFlight.current) return false;
    writeInFlight.current = true;
    setActiveWrite("book");
    setMutationError(null);
    try {
      await updateBook.mutateAsync(updates);
      return true;
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Could not save changes. Please try again.",
      );
      return false;
    } finally {
      writeInFlight.current = false;
      setActiveWrite(null);
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
    if (reviewDraft.text === null) return;
    const text = reviewDraft.text;
    if (await saveBook({ hiveId, review: text })) {
      reviewDraft.change(null);
    } else {
      // Optimistic canonical updates may have reconciled the local draft already.
      reviewDraft.change(text);
    }
  };

  const handleRatingUpdate = async (newRating: number) => {
    await saveBook({
      hiveId: hiveId,
      stars: newRating,
    });
  };

  const handleSaveProgress = async () => {
    if (isBusy || writeInFlight.current) return;
    setProgressError(null);
    setProgressSuccess(null);
    const result = progressDraftPayload(progressDraft.fields, new Date().toISOString());
    if (!result.ok) {
      setProgressError(result.error);
      return;
    }
    const submittedFields = progressDraft.fields;

    try {
      writeInFlight.current = true;
      setActiveWrite("progress");
      await updateBook.mutateAsync({
        hiveId,
        bookProgress: result.progress,
      });
      setProgressSuccess("Progress saved");
    } catch (error) {
      console.error("Failed to save progress:", error);
      progressDraft.restore(submittedFields);
      setProgressError("Failed to save progress.");
    } finally {
      writeInFlight.current = false;
      setActiveWrite(null);
    }
  };

  const handleStartedAtUpdate = async (date: string | null) => {
    return await saveBook({
      hiveId: hiveId,
      startedAt: date ?? "",
    });
  };

  const handleFinishedAtUpdate = async (date: string | null) => {
    return await saveBook({
      hiveId: hiveId,
      finishedAt: date ?? "",
    });
  };

  const handleDeleteBook = async () => {
    if (isBusy || writeInFlight.current) return;
    writeInFlight.current = true;
    setActiveWrite("delete");
    setMutationError(null);
    try {
      await deleteBook.mutateAsync({ hiveId });
      reviewDraft.change(null);
      setDeleteModalVisible(false);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "Could not delete book. Please try again.");
    } finally {
      writeInFlight.current = false;
      setActiveWrite(null);
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

  return (
    <View style={[styles.mainContainer, { backgroundColor, paddingBottom: bottom }]}>
      {/* Back Navigation Header */}
      <BackNavigationHeader
        title="Book"
        onBackPress={
          fromStatus
            ? () => {
                if (router.canGoBack()) router.back();
                else router.replace(`/books/${fromStatus}` as any);
              }
            : undefined
        }
      />

      <ScrollView ref={scrollViewRef} style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={[styles.contentContainer, { paddingBottom: 20 + bottom }]}>
          {/* Book Cover and Info Section */}
          <Animated.View style={styles.bookSection} entering={FadeInDown.delay(40).duration(220)}>
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
              <ThemedText style={[styles.author, { color: colors.secondaryText }]}>
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
                        color: colors.secondaryText,
                      },
                    ]}
                  >
                    {rating.toFixed(1)} ({book.ratingsCount.toLocaleString()})
                  </ThemedText>
                </View>
              )}
            </View>
          </Animated.View>

          <BookActionCard
            type="status"
            title="Reading status"
            icon="bookmark-outline"
            status={status}
            onStatusPress={() => {
              if (!isBusy) setModalVisible(true);
            }}
            isPending={isBusy}
            rightAccessory={
              <Pressable
                onPress={handleOwnedToggle}
                accessibilityRole="switch"
                accessibilityLabel="Own this book"
                accessibilityState={{ checked: Boolean(userBook.owned), disabled: isBusy }}
                disabled={isBusy}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name={userBook.owned ? "book" : "book-outline"}
                  size={18}
                  color={colors.secondaryText}
                />
                <ThemedText type="label">{userBook.owned ? "Owned" : "Own"}</ThemedText>
              </Pressable>
            }
          />
          {mutationError && (
            <ThemedText
              accessibilityRole="alert"
              style={[styles.progressError, { color: colors.errorText }]}
            >
              {mutationError}
            </ThemedText>
          )}

          <ReadingProgressCard
            progress={storedProgress}
            draft={progressDraft}
            isBusy={isBusy}
            saving={activeWrite === "progress"}
            error={progressError}
            success={progressSuccess}
            onSave={handleSaveProgress}
            editing={progressEditing}
            onEditingChange={setProgressEditing}
          />

          <Animated.View
            style={styles.actionsContainer}
            entering={FadeInDown.delay(140).duration(220)}
          >
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
              reviewText={reviewDraft.value}
              onReviewTextChange={reviewDraft.change}
            />
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
            {status && (
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => saveBook({ hiveId, status: "" })}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <ThemedText>Clear reading status</ThemedText>
              </Pressable>
            )}
          </Animated.View>

          <Animated.View style={styles.actionButtons} entering={FadeInDown.delay(80).duration(220)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share book"
              style={[
                styles.actionButton,
                {
                  borderColor: colors.cardBorder,
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
              accessibilityRole="button"
              accessibilityLabel="Add to List"
              style={[
                styles.actionButton,
                {
                  borderColor: colors.cardBorder,
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
              numberOfLines={descriptionExpanded ? undefined : 4}
              style={[styles.description, { color: colors.text }]}
            />
            {!!book.description && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: descriptionExpanded }}
                onPress={() => setDescriptionExpanded(!descriptionExpanded)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <ThemedText style={{ color: colors.text, textDecorationLine: "underline" }}>
                  {descriptionExpanded ? "Show less" : "Read full description"}
                </ThemedText>
              </Pressable>
            )}
          </Animated.View>

          {/* Genre Chips */}
          {genres.length > 0 && (
            <Animated.View
              style={styles.genreSection}
              entering={FadeInDown.delay(115).duration(220)}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.genreScroll}
              >
                {genres.map((genre) => (
                  <Pressable
                    key={genre}
                    accessibilityRole="button"
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
                      style={[styles.genreChipText, { color: colors.text }]}
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

          {/* Activity from other users */}
          <Animated.View
            style={styles.activitySection}
            entering={FadeInDown.delay(160).duration(220)}
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
                  color: colors.secondaryText,
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
                if (!isBusy && !writeInFlight.current) setDeleteModalVisible(false);
              }}
              onConfirm={handleDeleteBook}
              title="Remove from My Books?"
              message={
                mutationError ??
                "This removes this book from your profile and My Books, including its status, rating, review, reading dates and progress. The catalogue book stays available. This cannot be undone."
              }
              isPending={isBusy}
            />
          )}

          <Animated.View entering={FadeInUp.delay(180).duration(240)}>
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
          {hasTracking && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete book tracking"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={() => setDeleteModalVisible(true)}
              style={{
                minHeight: 44,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                borderRadius: 12,
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: 8,
                marginTop: 24,
                marginBottom: 12,
              }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.errorText} />
              <ThemedText style={{ color: colors.errorText }}>Remove from My Books</ThemedText>
            </Pressable>
          )}
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
  container: {
    flex: 1,
    paddingTop: 0, // Remove top padding since we have header now
  },
  contentContainer: {
    padding: 20,
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
    width: 96,
    height: 144,
    borderRadius: 8,
  },
  bookInfo: {
    flex: 1,
    minWidth: 0,
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
  ratingDisplay: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 6,
    rowGap: 4,
    alignItems: "center",
  },
  ratingsCount: {
    fontSize: 14,
    flexShrink: 1,
    maxWidth: "100%",
  },
  actionButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
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
    minHeight: 44,
    justifyContent: "center",
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
  activitySection: {
    marginBottom: 24,
  },

  progressError: {
    fontSize: 12,
    marginTop: 6,
  },
});
