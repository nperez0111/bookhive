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
  };

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
                  fontWeight: status ? "bold" : "normal",
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
              onRate={onRatingChange || (() => {})}
              disabled={isPending}
              starSize={32}
              style={styles.starRating}
            />
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
    <View style={[styles.actionCard, cardStyle]}>
      <View style={styles.actionCardHeader}>
        <Ionicons name={icon} size={24} color={colors.primary} />
        <ThemedText
          style={[styles.actionCardTitle, { color: colors.primaryText }]}
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
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  actionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  actionCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 12,
  },
  actionCardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionCardButtonActive: {
    borderColor: "#FBBF24", // This will be updated to use colors.primary
    backgroundColor: "rgba(251, 191, 36, 0.15)", // This will be updated to use colors.activeBackground
  },
  actionCardButtonText: {
    fontSize: 16,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  actionCardButtonTextActive: {
    color: "#FBBF24",
  },
  ratingContainer: {
    alignItems: "center",
    paddingVertical: 8,
  },
  starRating: {
    marginVertical: 8,
  },
  reviewInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
  },
  saveReviewButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  saveReviewButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
