import React from "react";
import { View, Pressable, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { StarRating } from "./StarRating";
import { BOOK_STATUS_MAP, type BookStatus } from "@/constants/index";

interface BookActionCardProps {
  type: "status" | "rating" | "review";
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  status?: BookStatus | null;
  rating?: number;
  review?: string;
  onStatusPress?: () => void;
  onRatingChange?: (rating: number) => void;
  onReviewChange?: (text: string) => void;
  onReviewSave?: () => void;
  isPending?: boolean;
  reviewText?: string;
  onReviewTextChange?: (text: string) => void;
}

export const BookActionCard: React.FC<BookActionCardProps> = ({
  type,
  title,
  icon,
  status,
  rating,
  review,
  onStatusPress,
  onRatingChange,
  onReviewChange,
  onReviewSave,
  isPending = false,
  reviewText = "",
  onReviewTextChange,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const cardStyle = {
    backgroundColor: colors.cardBackground,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowLight,
  };

  const containerStyle = [
    styles.actionCard,
    cardStyle,
    type === "rating" && { paddingVertical: 16 },
  ];

  const buttonStyle = {
    backgroundColor: colors.buttonBackground,
    borderColor: colors.buttonBorder,
  };

  const renderContent = () => {
    switch (type) {
      case "status":
        return (
          <Pressable
            style={[
              styles.actionCardButton,
              buttonStyle,
              status && {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
              },
            ]}
            onPress={onStatusPress}
          >
            <ThemedText
              style={[
                styles.actionCardButtonText,
                {
                  color: status ? colors.background : colors.secondaryText,
                  fontWeight: status ? "600" : "500",
                },
              ]}
            >
              {status ? BOOK_STATUS_MAP[status] : "Set your status"}
            </ThemedText>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={status ? colors.background : colors.secondaryText}
            />
          </Pressable>
        );

      case "rating":
        return (
          <View style={styles.ratingContainer}>
            <StarRating
              rating={rating}
              onRate={onRatingChange}
              disabled={isPending}
              starSize={28}
              style={styles.starRating}
            />
            {rating && (
              <ThemedText
                style={[styles.ratingText, { color: colors.secondaryText }]}
              >
                {rating / 2} out of 5 stars
              </ThemedText>
            )}
          </View>
        );

      case "review":
        return (
          <>
            <TextInput
              style={[
                styles.reviewInput,
                {
                  color: colors.primaryText,
                  backgroundColor: colors.buttonBackground,
                  borderColor: colors.buttonBorder,
                },
              ]}
              placeholder="Share your thoughts about this book..."
              value={reviewText}
              onChangeText={onReviewTextChange}
              multiline
              placeholderTextColor={colors.placeholderText}
            />
            {reviewText && (
              <Pressable
                style={[
                  styles.saveReviewButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: isPending ? 0.6 : 1,
                  },
                ]}
                onPress={onReviewSave}
                disabled={isPending}
              >
                <ThemedText
                  style={[
                    styles.saveReviewButtonText,
                    { color: colors.background },
                  ]}
                >
                  {isPending ? "Saving..." : "Save Review"}
                </ThemedText>
              </Pressable>
            )}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <View style={containerStyle}>
      <View
        style={[
          styles.actionCardHeader,
          type === "rating" && { marginBottom: 12 },
        ]}
      >
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.activeBackground },
          ]}
        >
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <ThemedText
          style={[styles.actionCardTitle, { color: colors.primaryText }]}
          type="heading"
        >
          {title}
        </ThemedText>
      </View>
      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  actionCard: {
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  actionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  actionCardTitle: {
    flex: 1,
  },
  actionCardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionCardButtonText: {
    fontSize: 16,
    textTransform: "capitalize",
  },
  ratingContainer: {
    alignItems: "center",
    paddingVertical: 6,
  },
  starRating: {
    marginVertical: 6,
  },
  ratingText: {
    marginTop: 4,
    fontSize: 13,
  },
  reviewInput: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
  },
  saveReviewButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  saveReviewButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
