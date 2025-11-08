import React, { useState } from "react";
import { View, Pressable, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { StarRating } from "./StarRating";
import { DatePickerModal } from "./DatePickerModal";
import { BOOK_STATUS_MAP, type BookStatus } from "@/constants/index";

interface BookActionCardProps {
  type: "status" | "rating" | "review" | "dates";
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  status?: BookStatus | null;
  rating?: number;
  review?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  onStatusPress?: () => void;
  onRatingChange?: (rating: number) => void;
  onReviewChange?: (text: string) => void;
  onReviewSave?: () => void;
  onStartedAtChange?: (date: string | null) => void;
  onFinishedAtChange?: (date: string | null) => void;
  isPending?: boolean;
  reviewText?: string;
  onReviewTextChange?: (text: string) => void;
  rightAccessory?: React.ReactNode;
}

export const BookActionCard: React.FC<BookActionCardProps> = ({
  type,
  title,
  icon,
  status,
  rating,
  review,
  startedAt,
  finishedAt,
  onStatusPress,
  onRatingChange,
  onReviewChange,
  onReviewSave,
  onStartedAtChange,
  onFinishedAtChange,
  isPending = false,
  reviewText = "",
  onReviewTextChange,
  rightAccessory,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  // Date picker state
  const [showStartedPicker, setShowStartedPicker] = useState(false);
  const [showFinishedPicker, setShowFinishedPicker] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  // Date handling functions
  const handleStartedDateConfirm = (date: Date) => {
    // Create date string at midnight UTC for the selected date
    // Extract year, month, day from the date (in local timezone)
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // Create a new Date at midnight UTC for this date
    const dateAtStartOfDayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const dateString = dateAtStartOfDayUTC.toISOString();
    onStartedAtChange?.(dateString);

    // Validate that finishedAt is after startedAt (allow same day)
    if (finishedAt && new Date(finishedAt) < dateAtStartOfDayUTC) {
      setDateError("Finished date must be on or after started date");
    } else {
      setDateError(null);
    }
    setShowStartedPicker(false);
  };

  const handleFinishedDateConfirm = (date: Date) => {
    // Create date string at midnight UTC for the selected date
    // Extract year, month, day from the date (in local timezone)
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    // Create a new Date at midnight UTC for this date
    const dateAtStartOfDayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const dateString = dateAtStartOfDayUTC.toISOString();
    onFinishedAtChange?.(dateString);

    // Validate that finishedAt is after startedAt (allow same day)
    if (startedAt && dateAtStartOfDayUTC < new Date(startedAt)) {
      setDateError("Finished date must be on or after started date");
    } else {
      setDateError(null);
    }
    setShowFinishedPicker(false);
  };

  const showDatePicker = (type: "started" | "finished") => {
    setShowStartedPicker(type === "started");
    setShowFinishedPicker(type === "finished");
  };

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

      case "dates":
        return (
          <View style={styles.datesContainer}>
            {/* Started Date */}
            <View style={styles.dateField}>
              <ThemedText
                style={[styles.dateLabel, { color: colors.primaryText }]}
                type="body"
              >
                Started Reading
              </ThemedText>
              <Pressable
                style={[
                  styles.dateButton,
                  {
                    backgroundColor: colors.buttonBackground,
                    borderColor: colors.buttonBorder,
                  },
                ]}
                onPress={() => showDatePicker("started")}
              >
                <ThemedText
                  style={[
                    styles.dateButtonText,
                    {
                      color: startedAt
                        ? colors.primaryText
                        : colors.placeholderText,
                    },
                  ]}
                >
                  {startedAt
                    ? format(new Date(startedAt), "MMM d, yyyy")
                    : "Select date"}
                </ThemedText>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={colors.secondaryText}
                />
              </Pressable>
            </View>

            {/* Finished Date */}
            <View style={styles.dateField}>
              <ThemedText
                style={[styles.dateLabel, { color: colors.primaryText }]}
                type="body"
              >
                Finished Reading
              </ThemedText>
              <Pressable
                style={[
                  styles.dateButton,
                  {
                    backgroundColor: colors.buttonBackground,
                    borderColor: colors.buttonBorder,
                  },
                ]}
                onPress={() => showDatePicker("finished")}
              >
                <ThemedText
                  style={[
                    styles.dateButtonText,
                    {
                      color: finishedAt
                        ? colors.primaryText
                        : colors.placeholderText,
                    },
                  ]}
                >
                  {finishedAt
                    ? format(new Date(finishedAt), "MMM d, yyyy")
                    : "Select date"}
                </ThemedText>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={colors.secondaryText}
                />
              </Pressable>
            </View>

            {/* Error Message */}
            {dateError && (
              <ThemedText
                style={[styles.dateError, { color: colors.error || "#ef4444" }]}
                type="caption"
              >
                {dateError}
              </ThemedText>
            )}

            {/* Date Picker Modals */}
            <DatePickerModal
              visible={showStartedPicker}
              title="Select Started Date"
              initialDate={startedAt ? new Date(startedAt) : undefined}
              maximumDate={finishedAt ? new Date(finishedAt) : undefined}
              onConfirm={handleStartedDateConfirm}
              onCancel={() => setShowStartedPicker(false)}
            />

            <DatePickerModal
              visible={showFinishedPicker}
              title="Select Finished Date"
              initialDate={finishedAt ? new Date(finishedAt) : undefined}
              minimumDate={startedAt ? new Date(startedAt) : undefined}
              onConfirm={handleFinishedDateConfirm}
              onCancel={() => setShowFinishedPicker(false)}
            />
          </View>
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
        {rightAccessory ? (
          <View style={styles.headerAccessory}>{rightAccessory}</View>
        ) : null}
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
  headerAccessory: {
    marginLeft: 8,
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
  datesContainer: {
    gap: 16,
  },
  dateField: {
    gap: 8,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateButtonText: {
    fontSize: 16,
    flex: 1,
  },
  dateError: {
    fontSize: 12,
    marginTop: 4,
  },
});
