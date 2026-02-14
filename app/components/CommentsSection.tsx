import * as BuzzBookhiveDefs from "@/../src/bsky/lexicon/generated/types/buzz/bookhive/defs";
import { Colors } from "@/constants/Colors";
import { getBaseUrl, useAuth } from "@/context/auth";
import { useUpdateComment } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import React, { useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { ThemedButton } from "./ThemedButton";
import { ThemedText } from "./ThemedText";

// Union type for both comments and reviews
export type CommentItem = (
  | (BuzzBookhiveDefs.Comment & { uri?: string; cid?: string })
  | (BuzzBookhiveDefs.Review & { uri?: string; cid?: string })
) & {
  id: string; // Add an id for React keys
};

interface CommentsSectionProps {
  comments: CommentItem[];
  hiveId: string;
  onUserPress?: (userDid: string) => void;
  onReplyClick?: (
    commentId: string,
    replyFormRef: React.RefObject<View>,
  ) => void;
}

// Star Rating Component for comments
const CommentStarRating: React.FC<{ rating: number; size?: number }> = ({
  rating,
  size = 16,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  // Convert 1-10 rating to 1-5 stars
  const starRating = rating ? Math.round(rating / 2) : 0;

  return (
    <View style={styles.starRating}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={starRating >= star ? "star" : "star-outline"}
          size={size}
          color={
            starRating >= star
              ? colors.primary
              : colorScheme === "dark"
                ? "#9CA3AF"
                : colors.icon
          }
        />
      ))}
    </View>
  );
};

// Individual Comment Component
const CommentItem: React.FC<{
  comment: CommentItem;
  hiveId: string;
  onUserPress: (userDid: string) => void;
  onReplyClick?: (
    commentId: string,
    replyFormRef: React.RefObject<View>,
  ) => void;
}> = ({ comment, hiveId, onUserPress, onReplyClick }) => {
  const { authState } = useAuth();
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const replyFormRef = useRef<View>(null);
  const updateComment = useUpdateComment();

  // Determine if this is a review or comment
  const isReview = "review" in comment;
  const content = isReview ? comment.review : comment.comment;
  const rating = isReview ? comment.stars : undefined;
  const userDid = comment.did;
  const userHandle = comment.handle;

  const handleReply = async () => {
    if (!replyText.trim()) return;

    try {
      // Both comments and reviews can have replies
      if (isReview && "uri" in comment && comment.uri && comment.cid) {
        // For reviews, use the review's URI and CID as parent
        await updateComment.mutateAsync({
          hiveId: hiveId as any,
          comment: replyText,
          parentUri: comment.uri,
          parentCid: comment.cid,
        });
        setReplyText("");
        setShowReplyForm(false);
      } else if (!isReview && "uri" in comment && comment.uri && comment.cid) {
        // For comments, use the comment's URI and CID as parent
        await updateComment.mutateAsync({
          hiveId: hiveId as any,
          comment: replyText,
          parentUri: comment.uri,
          parentCid: comment.cid,
        });
        setReplyText("");
        setShowReplyForm(false);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to post reply");
    }
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;

    try {
      if (
        "uri" in comment &&
        comment.uri &&
        "parent" in comment &&
        typeof comment.parent === "object" &&
        comment.parent !== null
      ) {
        // Use the comment's parent URI and CID
        const parent = comment.parent as { uri: string; cid: string };
        await updateComment.mutateAsync({
          hiveId: hiveId as any,
          comment: editText,
          parentUri: parent.uri,
          parentCid: parent.cid,
          uri: comment.uri!,
        });
        setIsEditing(false);
        setEditText("");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to edit comment");
    }
  };

  const startEditing = () => {
    setEditText(isReview ? comment.review : comment.comment);
    setIsEditing(true);
  };

  const handleReplyButtonClick = () => {
    setShowReplyForm(!showReplyForm);
    if (!showReplyForm && onReplyClick) {
      // Call the callback with the comment ID and ref when opening reply form
      onReplyClick(comment.id, replyFormRef);
    }
  };

  return (
    <View
      style={[
        styles.commentContainer,
        {
          borderBottomColor:
            colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.1)"
              : "rgba(0, 0, 0, 0.1)",
        },
      ]}
    >
      {/* User Header */}
      <View style={styles.userHeader}>
        <Pressable style={styles.userInfo} onPress={() => onUserPress(userDid)}>
          <Image
            source={{
              uri: `${getBaseUrl()}/profile/${userHandle}/image`,
            }}
            style={styles.avatar}
          />
          <View style={styles.userDetails}>
            <ThemedText
              style={[
                styles.userName,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
            >
              @{userHandle}
            </ThemedText>
          </View>
        </Pressable>

        {/* Rating - only show for reviews */}
        {rating && <CommentStarRating rating={rating} />}
      </View>

      {/* Timestamp */}
      <ThemedText
        style={[
          styles.timestamp,
          { color: colorScheme === "dark" ? "#9CA3AF" : colors.icon },
        ]}
      >
        {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
      </ThemedText>

      {/* Comment Text */}
      {isEditing ? (
        <View style={styles.editForm}>
          <TextInput
            style={[
              styles.editInput,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
                color: colors.primaryText,
              },
            ]}
            placeholder="Edit your comment..."
            placeholderTextColor={colors.placeholderText}
            value={editText}
            onChangeText={setEditText}
            multiline
            numberOfLines={3}
          />
          <View style={styles.editActions}>
            <ThemedButton
              title="Cancel"
              onPress={() => {
                setIsEditing(false);
                setEditText("");
              }}
              variant="ghost"
              size="small"
            />
            <ThemedButton
              title="Save"
              onPress={handleEdit}
              variant="primary"
              size="small"
              disabled={!editText.trim()}
            />
          </View>
        </View>
      ) : (
        <ThemedText
          style={[
            styles.commentText,
            { color: colorScheme === "dark" ? "#E5E7EB" : colors.text },
          ]}
        >
          {content}
        </ThemedText>
      )}

      {/* Interaction Footer */}
      <View style={styles.interactionFooter}>
        <View style={styles.interactionButtons}>
          {authState && (
            <>
              <Pressable
                style={styles.interactionButton}
                onPress={handleReplyButtonClick}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={20}
                  color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
                />
                <ThemedText
                  style={[
                    styles.interactionText,
                    { color: colorScheme === "dark" ? "#9CA3AF" : colors.icon },
                  ]}
                >
                  Reply
                </ThemedText>
              </Pressable>

              {/* Edit button - only show for user's own comments */}
              {authState.did === userDid && (
                <Pressable
                  style={styles.interactionButton}
                  onPress={startEditing}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={20}
                    color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
                  />
                  <ThemedText
                    style={[
                      styles.interactionText,
                      {
                        color: colorScheme === "dark" ? "#9CA3AF" : colors.icon,
                      },
                    ]}
                  >
                    Edit
                  </ThemedText>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>

      {/* Reply Form */}
      {showReplyForm && (
        <View ref={replyFormRef} style={styles.replyForm}>
          <TextInput
            style={[
              styles.replyInput,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
                color: colors.primaryText,
              },
            ]}
            placeholder="Write a reply..."
            placeholderTextColor={colors.placeholderText}
            value={replyText}
            onChangeText={setReplyText}
            multiline
            numberOfLines={3}
          />
          <View style={styles.replyActions}>
            <ThemedButton
              title="Cancel"
              onPress={() => {
                setShowReplyForm(false);
                setReplyText("");
              }}
              variant="ghost"
              size="small"
            />
            <ThemedButton
              title="Reply"
              onPress={handleReply}
              variant="primary"
              size="small"
              disabled={!replyText.trim()}
            />
          </View>
        </View>
      )}
    </View>
  );
};

export const CommentsSection: React.FC<CommentsSectionProps> = ({
  comments,
  hiveId,
  onUserPress,
  onReplyClick,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const handleUserPress = (userDid: string) => {
    onUserPress?.(userDid);
  };

  const handleReplyClick = (
    commentId: string,
    replyFormRef: React.RefObject<View>,
  ) => {
    // Call the parent callback
    onReplyClick?.(commentId, replyFormRef);
  };

  // Organize comments into a threaded structure
  const organizeCommentsIntoThreads = (comments: CommentItem[]) => {
    const topLevelComments: CommentItem[] = [];
    const repliesByParent = new Map<string, CommentItem[]>();

    // First pass: create a map of all comments and identify top-level ones
    comments.forEach((comment) => {
      if (isReview(comment)) {
        // Reviews are always top-level
        topLevelComments.push(comment);
      } else if (
        "parent" in comment &&
        comment.parent &&
        typeof comment.parent === "object" &&
        comment.parent !== null
      ) {
        // This is a reply - organize by parent URI
        const parentUri = (comment.parent as any).uri;
        if (parentUri) {
          if (!repliesByParent.has(parentUri)) {
            repliesByParent.set(parentUri, []);
          }
          repliesByParent.get(parentUri)!.push(comment);
        }
      }
      // Note: Regular comments without parents are not top-level - they're replies to reviews
    });

    return { topLevelComments, repliesByParent };
  };

  // Helper function to check if a comment is a review
  const isReview = (comment: CommentItem): boolean => {
    return "review" in comment;
  };

  // Render a comment with its replies
  const renderCommentWithReplies = (
    comment: CommentItem,
    depth: number = 0,
  ) => {
    // Get replies for this comment using its URI
    let commentUri: string;
    if ("uri" in comment && comment.uri) {
      commentUri = comment.uri;
    } else {
      commentUri = comment.id;
    }
    const replies = repliesByParent.get(commentUri) || [];

    return (
      <View
        key={comment.id}
        style={[styles.threadedComment, { marginLeft: depth * 20 }]}
      >
        <CommentItem
          comment={comment}
          hiveId={hiveId}
          onUserPress={handleUserPress}
          onReplyClick={handleReplyClick}
        />

        {/* Render replies */}
        {replies.length > 0 && (
          <View
            style={[
              styles.repliesContainer,
              {
                borderLeftColor:
                  colorScheme === "dark"
                    ? "rgba(255, 255, 255, 0.1)"
                    : "rgba(0, 0, 0, 0.1)",
              },
            ]}
          >
            {replies.map((reply) => renderCommentWithReplies(reply, depth + 1))}
          </View>
        )}
      </View>
    );
  };

  const { topLevelComments, repliesByParent } =
    organizeCommentsIntoThreads(comments);

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <ThemedText
          style={[
            styles.sectionTitle,
            { color: colorScheme === "dark" ? "white" : colors.text },
          ]}
        >
          Comments {comments.length > 0 && `(${comments.length})`}
        </ThemedText>
      </View>

      {comments.length === 0 ? (
        <View
          style={[
            styles.emptyState,
            {
              backgroundColor:
                colorScheme === "dark"
                  ? "rgba(255, 255, 255, 0.05)"
                  : "rgba(0, 0, 0, 0.05)",
              borderColor:
                colorScheme === "dark"
                  ? "rgba(255, 255, 255, 0.1)"
                  : "rgba(0, 0, 0, 0.1)",
            },
          ]}
        >
          <Ionicons
            name="chatbubble-outline"
            size={48}
            color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
          />
          <ThemedText
            style={[
              styles.emptyStateText,
              { color: colorScheme === "dark" ? "#9CA3AF" : colors.icon },
            ]}
          >
            No comments yet. Be the first to share your thoughts!
          </ThemedText>
        </View>
      ) : (
        <View>
          {topLevelComments.map((comment, index) => (
            <React.Fragment key={comment.id}>
              {renderCommentWithReplies(comment)}
              {index < topLevelComments.length - 1 && (
                <View
                  style={[
                    styles.separator,
                    {
                      backgroundColor:
                        colorScheme === "dark"
                          ? "rgba(255, 255, 255, 0.1)"
                          : "rgba(0, 0, 0, 0.1)",
                    },
                  ]}
                />
              )}
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  commentContainer: {
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  starRating: {
    flexDirection: "row",
    alignItems: "center",
  },
  timestamp: {
    fontSize: 14,
    marginBottom: 12,
  },
  commentText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  interactionFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  interactionButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  interactionButton: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 24,
  },
  interactionText: {
    fontSize: 14,
    marginLeft: 4,
  },
  replyForm: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.02)",
  },
  replyInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
  },
  replyActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  editForm: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.02)",
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  threadedComment: {
    marginBottom: 8,
  },
  repliesContainer: {
    marginTop: 8,
    paddingLeft: 16,
    borderLeftWidth: 2,
  },
  separator: {
    height: 1,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyStateText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: "center",
  },
});
