import React from "react";
import { View, StyleSheet, FlatList, Pressable, Image } from "react-native";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";
import * as BuzzBookhiveDefs from "@/../src/bsky/lexicon/types/buzz/bookhive/defs";
import { getBaseUrl } from "@/context/auth";

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
  // Convert 1-10 rating to 1-5 stars
  const starRating = rating ? Math.round(rating / 2) : 0;

  return (
    <View style={styles.starRating}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={starRating >= star ? "star" : "star-outline"}
          size={size}
          color={starRating >= star ? "#FBBF24" : "#9CA3AF"}
        />
      ))}
    </View>
  );
};

// Individual Comment Component
const CommentItem: React.FC<{
  comment: CommentItem;
  onLike: (commentId: string) => void;
  onCommentPress: (commentId: string) => void;
  onUserPress: (userDid: string) => void;
}> = ({ comment, onLike, onCommentPress, onUserPress }) => {
  const textColor = useThemeColor({}, "text");
  const backgroundColor = useThemeColor({}, "background");

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffInDays === 0) {
      return "Today";
    } else if (diffInDays === 1) {
      return "Yesterday";
    } else if (diffInDays < 7) {
      return `${diffInDays} days ago`;
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  };

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
        { borderBottomColor: "rgba(255, 255, 255, 0.1)" },
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
            <ThemedText style={styles.userName}>{userHandle}</ThemedText>
          </View>
        </Pressable>

        {/* Rating - only show for reviews */}
        {rating && <CommentStarRating rating={rating} />}
      </View>

      {/* Timestamp */}
      <ThemedText style={styles.timestamp}>
        {formatTimestamp(comment.createdAt)}
      </ThemedText>

      {/* Comment Text */}
      <ThemedText style={styles.commentText}>{content}</ThemedText>

      {/* Interaction Footer */}
      <View style={styles.interactionFooter}>
        <View style={styles.interactionButtons}>
          <Pressable
            style={styles.interactionButton}
            onPress={() => onLike(comment.id)}
          >
            <Ionicons name="heart-outline" size={20} color="#9CA3AF" />
          </Pressable>

          <Pressable
            style={styles.interactionButton}
            onPress={() => onCommentPress(comment.id)}
          >
            <Ionicons name="chatbubble-outline" size={20} color="#9CA3AF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export const CommentsSection: React.FC<CommentsSectionProps> = ({
  comments,
  onLikeComment,
  onCommentPress,
  onUserPress,
}) => {
  const handleLike = (commentId: string) => {
    onLikeComment?.(commentId);
  };

  const handleCommentPress = (commentId: string) => {
    onCommentPress?.(commentId);
  };

  const handleUserPress = (userDid: string) => {
    onUserPress?.(userDid);
  };

  return (
    <View style={styles.container}>
      <ThemedText style={styles.sectionTitle}>Comments</ThemedText>

      {comments.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubble-outline" size={48} color="#9CA3AF" />
          <ThemedText style={styles.emptyStateText}>
            No comments yet. Be the first to share your thoughts!
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CommentItem
              comment={item}
              onLike={handleLike}
              onCommentPress={handleCommentPress}
              onUserPress={handleUserPress}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
        />
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
    color: "white",
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
    color: "white",
    marginBottom: 2,
  },
  starRating: {
    flexDirection: "row",
    alignItems: "center",
  },
  timestamp: {
    fontSize: 14,
    color: "#9CA3AF",
    marginBottom: 12,
  },
  commentText: {
    fontSize: 16,
    lineHeight: 24,
    color: "#E5E7EB",
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
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  emptyStateText: {
    marginTop: 12,
    color: "#9CA3AF",
    fontSize: 16,
    textAlign: "center",
  },
});
