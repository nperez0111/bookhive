import React, { useRef, useState } from "react";
import { View, Pressable, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { StarRating } from "./StarRating";
import { DatePickerModal } from "./DatePickerModal";
import { BOOK_STATUS_MAP, type BookStatus } from "@/constants/index";
import { calendarDate } from "@/utils/calendarDate";

interface CommonProps {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  isPending?: boolean;
  rightAccessory?: React.ReactNode;
}

type BookActionCardProps = CommonProps &
  (
    | { type: "status"; status: BookStatus | null; onStatusPress: () => void }
    | { type: "rating"; rating?: number; onRatingChange: (rating: number) => void }
    | {
        type: "review";
        review?: string;
        reviewText: string;
        onReviewTextChange: (text: string) => void;
        onReviewSave: () => void;
      }
    | {
        type: "dates";
        startedAt?: string | null;
        finishedAt?: string | null;
        onStartedAtChange: (date: string | null) => Promise<boolean>;
        onFinishedAtChange: (date: string | null) => Promise<boolean>;
      }
  );

export const BookActionCard: React.FC<BookActionCardProps> = (props) => {
  const { type, title, isPending = false, rightAccessory } = props;
  const dates = props.type === "dates" ? props : undefined;
  const startedAt = dates?.startedAt;
  const finishedAt = dates?.finishedAt;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  // Date picker state
  const [showStartedPicker, setShowStartedPicker] = useState(false);
  const [showFinishedPicker, setShowFinishedPicker] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [dateSaving, setDateSaving] = useState(false);
  const dateInFlight = useRef(false);
  const [expanded, setExpanded] = useState(false);

  // Date handling functions
  const saveDate = async (field: "started" | "finished", date: string) => {
    if (!dates || isPending || dateInFlight.current) return;
    dateInFlight.current = true;
    setDateSaving(true);
    setDateError(null);
    try {
      const saved = await (field === "started"
        ? dates.onStartedAtChange(date)
        : dates.onFinishedAtChange(date));
      if (saved) {
        if (field === "started") setShowStartedPicker(false);
        else setShowFinishedPicker(false);
      } else {
        setDateError("Could not save this date. Please try again.");
      }
    } catch (error) {
      setDateError(
        error instanceof Error ? error.message : "Could not save this date. Please try again.",
      );
    } finally {
      dateInFlight.current = false;
      setDateSaving(false);
    }
  };

  const handleStartedDateConfirm = async (date: Date) => {
    if (!dates || isPending || dateInFlight.current) return;
    // Extract year, month, day from the selected date (in local timezone)
    // Format as YYYY-MM-DD - backend will convert to UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateString = `${year}-${month}-${day}`;

    // Validate that finishedAt is on or after startedAt (allow same day)
    // Compare date strings directly (handle both YYYY-MM-DD and ISO formats)
    if (finishedAt) {
      const finishedDateStr = finishedAt.includes("T") ? finishedAt.split("T")[0] : finishedAt;
      if (finishedDateStr < dateString) {
        setDateError("Finished date must be on or after started date");
        return;
      } else {
        setDateError(null);
      }
    } else {
      setDateError(null);
    }
    await saveDate("started", dateString);
  };

  const handleFinishedDateConfirm = async (date: Date) => {
    if (!dates || isPending || dateInFlight.current) return;
    // Extract year, month, day from the selected date (in local timezone)
    // Format as YYYY-MM-DD - backend will convert to UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateString = `${year}-${month}-${day}`;

    // Validate that finishedAt is on or after startedAt (allow same day)
    // Compare date strings directly (handle both YYYY-MM-DD and ISO formats)
    if (startedAt) {
      const startedDateStr = startedAt.includes("T") ? startedAt.split("T")[0] : startedAt;
      if (dateString < startedDateStr) {
        setDateError("Finished date must be on or after started date");
        return;
      } else {
        setDateError(null);
      }
    } else {
      setDateError(null);
    }
    await saveDate("finished", dateString);
  };

  const showDatePicker = (type: "started" | "finished") => {
    if (isPending || dateInFlight.current) return;
    setDateError(null);
    setShowStartedPicker(type === "started");
    setShowFinishedPicker(type === "finished");
  };

  const cardStyle = {
    backgroundColor: "transparent",
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowLight,
  };

  const containerStyle = [styles.actionCard, cardStyle];

  const renderContent = () => {
    switch (props.type) {
      case "status": {
        const { status, onStatusPress } = props;
        return (
          <Pressable
            style={[
              styles.actionCardButton,
              {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
              },
            ]}
            onPress={onStatusPress}
            accessibilityRole="button"
            accessibilityState={{ disabled: isPending }}
            disabled={isPending}
          >
            <ThemedText
              style={[
                styles.actionCardButtonText,
                {
                  color: Colors.light.primaryText,
                  fontWeight: "600",
                },
              ]}
            >
              {status ? BOOK_STATUS_MAP[status] : "Choose reading status"}
            </ThemedText>
            <Ionicons name="chevron-forward" size={20} color={Colors.light.primaryText} />
          </Pressable>
        );
      }

      case "rating": {
        const { rating, onRatingChange } = props;
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
      }

      case "review": {
        const { review, reviewText, onReviewTextChange, onReviewSave } = props;
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
              accessibilityLabel="Your review"
              value={reviewText}
              onChangeText={onReviewTextChange}
              editable={!isPending}
              multiline
              placeholderTextColor={colors.placeholderText}
            />
            {reviewText !== (review ?? "") && (
              <Pressable
                style={[
                  styles.saveReviewButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: isPending ? 0.6 : 1,
                  },
                ]}
                onPress={onReviewSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: isPending, busy: isPending }}
                disabled={isPending}
              >
                <ThemedText
                  style={[styles.saveReviewButtonText, { color: Colors.light.primaryText }]}
                >
                  {isPending ? "Saving..." : "Save Review"}
                </ThemedText>
              </Pressable>
            )}
          </>
        );
      }

      case "dates": {
        const { onStartedAtChange, onFinishedAtChange } = props;
        return (
          <View style={styles.datesContainer}>
            {/* Started Date */}
            <View style={styles.dateField}>
              <ThemedText style={[styles.dateLabel, { color: colors.primaryText }]} type="body">
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
                accessibilityRole="button"
                accessibilityLabel="Change started date"
                disabled={isPending}
              >
                <ThemedText
                  style={[
                    styles.dateButtonText,
                    {
                      color: startedAt ? colors.primaryText : colors.placeholderText,
                    },
                  ]}
                >
                  {startedAt ? format(calendarDate(startedAt), "MMM d, yyyy") : "Select date"}
                </ThemedText>
                <Ionicons name="calendar-outline" size={20} color={colors.secondaryText} />
              </Pressable>
              {startedAt && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear started date"
                  disabled={isPending}
                  onPress={() => {
                    setDateError(null);
                    onStartedAtChange(null);
                  }}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <ThemedText type="caption">Clear started date</ThemedText>
                </Pressable>
              )}
            </View>

            {/* Finished Date */}
            <View style={styles.dateField}>
              <ThemedText style={[styles.dateLabel, { color: colors.primaryText }]} type="body">
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
                accessibilityRole="button"
                accessibilityLabel="Change finished date"
                disabled={isPending}
              >
                <ThemedText
                  style={[
                    styles.dateButtonText,
                    {
                      color: finishedAt ? colors.primaryText : colors.placeholderText,
                    },
                  ]}
                >
                  {finishedAt ? format(calendarDate(finishedAt), "MMM d, yyyy") : "Select date"}
                </ThemedText>
                <Ionicons name="calendar-outline" size={20} color={colors.secondaryText} />
              </Pressable>
              {finishedAt && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear finished date"
                  disabled={isPending}
                  onPress={() => {
                    setDateError(null);
                    onFinishedAtChange(null);
                  }}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <ThemedText type="caption">Clear finished date</ThemedText>
                </Pressable>
              )}
            </View>

            {/* Error Message */}
            {dateError && (
              <ThemedText
                accessibilityRole="alert"
                style={[styles.dateError, { color: colors.errorText }]}
                type="caption"
              >
                {dateError}
              </ThemedText>
            )}

            {/* Date Picker Modals */}
            <DatePickerModal
              visible={showStartedPicker && (!isPending || dateSaving)}
              isPending={dateSaving}
              error={dateError}
              title="Select Started Date"
              initialDate={startedAt ? calendarDate(startedAt) : undefined}
              maximumDate={finishedAt ? calendarDate(finishedAt) : undefined}
              onConfirm={handleStartedDateConfirm}
              onCancel={() => {
                if (!dateInFlight.current) setShowStartedPicker(false);
              }}
            />

            <DatePickerModal
              visible={showFinishedPicker && (!isPending || dateSaving)}
              isPending={dateSaving}
              error={dateError}
              title="Select Finished Date"
              initialDate={finishedAt ? calendarDate(finishedAt) : undefined}
              minimumDate={startedAt ? calendarDate(startedAt) : undefined}
              onConfirm={handleFinishedDateConfirm}
              onCancel={() => {
                if (!dateInFlight.current) setShowFinishedPicker(false);
              }}
            />
          </View>
        );
      }

      default:
        return null;
    }
  };

  return (
    <View style={containerStyle}>
      <Pressable
        accessible={type !== "status"}
        accessibilityRole={type !== "status" ? "button" : undefined}
        accessibilityState={type !== "status" ? { expanded } : undefined}
        accessibilityLabel={
          type !== "status" ? `Edit ${type === "dates" ? "reading dates" : type}` : undefined
        }
        onPress={type !== "status" ? () => setExpanded(!expanded) : undefined}
        style={[styles.actionCardHeader, type === "status" && { marginBottom: 8 }]}
      >
        <View style={styles.actionCardTitle}>
          <ThemedText
            accessibilityRole={type === "status" ? "header" : undefined}
            style={{
              color: colors.primaryText,
              fontSize: type === "status" ? 20 : 18,
              lineHeight: type === "status" ? 28 : 24,
              fontWeight: "600",
            }}
          >
            {title}
          </ThemedText>
          {type !== "status" && !expanded && (
            <ThemedText
              numberOfLines={2}
              style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}
            >
              {props.type === "rating"
                ? props.rating
                  ? `${props.rating / 2} out of 5`
                  : "Not rated"
                : props.type === "review"
                  ? props.reviewText || "Add your thoughts"
                  : [
                      startedAt ? `Started ${startedAt.slice(0, 10)}` : "",
                      finishedAt ? `Finished ${finishedAt.slice(0, 10)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Add reading dates"}
            </ThemedText>
          )}
        </View>
        {rightAccessory ? <View style={styles.headerAccessory}>{rightAccessory}</View> : null}
        {type !== "status" && (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.secondaryText}
          />
        )}
      </Pressable>
      {(type === "status" || expanded) && renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  actionCard: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionCardHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionCardButtonText: {
    fontSize: 16,
  },
  ratingContainer: {
    alignItems: "center",
    paddingVertical: 6,
  },
  starRating: {
    marginVertical: 6,
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
