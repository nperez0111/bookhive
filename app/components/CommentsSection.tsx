import * as BuzzBookhiveDefs from "@/../src/bsky/lexicon/types/buzz/bookhive/defs";
import { getBaseUrl } from "@/context/auth";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

// Union type for both comments and reviews
export type CommentItem = (
  | BuzzBookhiveDefs.Comment
  | BuzzBookhiveDefs.Review
) & {
  id: string; // Add an id for React keys
};

interface CommentsSectionProps {
  comments: CommentItem[];
  onLikeComment?: (commentId: string) => void;
  onCommentPress?: (commentId: string) => void;
  onUserPress?: (userDid: string) => void;
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
  onCommentPress: (commentId: string) => void;
  onUserPress: (userDid: string) => void;
}> = ({ comment, onCommentPress, onUserPress }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  // Determine if this is a review or comment
  const isReview = "review" in comment;
  const content = isReview ? comment.review : comment.comment;
  const rating = isReview ? comment.stars : undefined;
  const userDid = comment.did;
  const userHandle = comment.handle;

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
      <ThemedText
        style={[
          styles.commentText,
          { color: colorScheme === "dark" ? "#E5E7EB" : colors.text },
        ]}
      >
        {content}
      </ThemedText>

      {/* Interaction Footer */}
      <View style={styles.interactionFooter}>
        <View style={styles.interactionButtons}>
          <Pressable
            style={styles.interactionButton}
            onPress={() => onCommentPress(comment.id)}
          >
            <Ionicons
              name="chatbubble-outline"
              size={20}
              color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export const CommentsSection: React.FC<CommentsSectionProps> = ({
  comments,
  onCommentPress,
  onUserPress,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const handleCommentPress = (commentId: string) => {
    onCommentPress?.(commentId);
  };

  const handleUserPress = (userDid: string) => {
    onUserPress?.(userDid);
  };

  return (
    <View style={styles.container}>
      <ThemedText
        style={[
          styles.sectionTitle,
          { color: colorScheme === "dark" ? "white" : colors.text },
        ]}
      >
        Comments
      </ThemedText>

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
          {comments.map((comment, index) => (
            <React.Fragment key={comment.id}>
              <CommentItem
                comment={comment}
                onCommentPress={handleCommentPress}
                onUserPress={handleUserPress}
              />
              {index < comments.length - 1 && (
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
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
