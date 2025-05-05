import { ThemedText } from "@/components/ThemedText";
import { useBookInfo, useUpdateBookStatus } from "@/hooks/useBookhiveQuery";
import { useLocalSearchParams, router } from "expo-router";
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  Linking,
  TouchableOpacity,
  FlatList,
} from "react-native";
import type { HiveId } from "../../../../src/types";
import {
  BOOK_STATUS_MAP,
  BOOK_STATUS,
  type BookStatus,
} from "../../../constants/index";
import { decode } from "html-entities";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ThemedView } from "@/components/ThemedView";
import { getBaseUrl } from "@/context/auth";

const STATUS_OPTIONS = [
  BOOK_STATUS.FINISHED,
  BOOK_STATUS.READING,
  BOOK_STATUS.WANTTOREAD,
  BOOK_STATUS.ABANDONED,
];

export default function BookInfo() {
  const { id } = useLocalSearchParams();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<BookStatus | null>(
    BOOK_STATUS.WANTTOREAD,
  );

  const updateBookStatus = useUpdateBookStatus();

  const bookQuery = useBookInfo(
    typeof id === "string" ? (id as HiveId) : (id[0] as HiveId),
  );

  const handleStatusUpdate = async (status: NonNullable<BookStatus>) => {
    let currentStatus = selectedStatus;
    setSelectedStatus(status);
    try {
      console.log({
        hiveId: bookQuery.data?.book.id as HiveId,
        status: status,
      });
      await updateBookStatus.mutateAsync({
        hiveId: bookQuery.data?.book.id as HiveId,
        status: status,
      });
    } catch (error) {
      console.error("Failed to update status:", error);
      setSelectedStatus(currentStatus);
    } finally {
      setModalVisible(false);
    }
  };

  if (bookQuery.isLoading) {
    return <ActivityIndicator size="large" color="#0000ff" />;
  }

  if (bookQuery.error) {
    return <ThemedText>Error: {bookQuery.error.message}</ThemedText>;
  }

  const { book } = bookQuery.data!;
  const rating = book.rating ? book.rating / 1000 : 0;

  return (
    <View style={styles.mainContainer}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color="#666" />
      </Pressable>

      <ScrollView style={styles.container}>
        <View style={styles.contentContainer}>
          {/* Book Cover Section */}
          <View style={styles.coverContainer}>
            <Image
              source={{
                uri: `${getBaseUrl()}/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`,
              }}
              style={styles.cover}
              resizeMode="cover"
            />
          </View>

          {/* Book Info Section */}
          <View style={styles.infoContainer}>
            <ThemedText style={styles.title}>{book.title}</ThemedText>
            <ThemedText style={styles.author}>
              by {book.authors.split("\t").join(", ")}
            </ThemedText>

            {/* Rating Section */}
            {book.rating && book.ratingsCount && (
              <View style={styles.ratingContainer}>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <View key={star} style={styles.starWrapper}>
                      <ThemedText style={[styles.star, styles.starBackground]}>
                        ★
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.star,
                          styles.starFilled,
                          {
                            width: `${Math.min(
                              100,
                              Math.max(0, (rating - (star - 1)) * 100),
                            )}%`,
                          },
                        ]}
                      >
                        ★
                      </ThemedText>
                    </View>
                  ))}
                </View>
                <ThemedText style={styles.ratingText}>
                  {rating.toFixed(2)} ({book.ratingsCount.toLocaleString()}{" "}
                  ratings)
                </ThemedText>
              </View>
            )}

            {/* Status Button / Dropdown Trigger */}
            <Pressable
              style={styles.statusButton}
              onPress={() => setModalVisible(true)}
            >
              <ThemedText style={styles.statusButtonText}>
                {selectedStatus
                  ? BOOK_STATUS_MAP[selectedStatus]
                  : "Add to Shelf"}
              </ThemedText>
              <Ionicons
                name="chevron-down"
                size={16}
                color="white"
                style={{ marginLeft: 8 }}
              />
            </Pressable>

            {/* Status Selection Modal */}
            <Modal
              animationType="fade"
              transparent={true}
              visible={modalVisible}
              onRequestClose={() => {
                setModalVisible(!modalVisible);
              }}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={() => setModalVisible(false)}
              >
                <ThemedView
                  style={styles.modalView}
                  onStartShouldSetResponder={() => true}
                >
                  {updateBookStatus.isPending ? (
                    <ActivityIndicator
                      size="large"
                      color="#4CAF50"
                      style={{ paddingVertical: 20 }}
                    />
                  ) : (
                    <FlatList
                      data={STATUS_OPTIONS}
                      keyExtractor={(item) => item}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[styles.modalOption]}
                          onPress={() => handleStatusUpdate(item)}
                        >
                          <ThemedText
                            style={[styles.modalOptionText]}
                            type={
                              selectedStatus === item
                                ? "defaultSemiBold"
                                : "default"
                            }
                            themeSource={
                              selectedStatus === item ? "tint" : "text"
                            }
                          >
                            {BOOK_STATUS_MAP[item]}
                          </ThemedText>
                        </TouchableOpacity>
                      )}
                      ItemSeparatorComponent={() => (
                        <View style={styles.separator} />
                      )}
                    />
                  )}
                </ThemedView>
              </Pressable>
            </Modal>

            {/* Display mutation error if any */}
            {updateBookStatus.error && (
              <ThemedText style={styles.errorText}>
                Error: {updateBookStatus.error.message}
              </ThemedText>
            )}

            {/* Description */}
            <View style={styles.descriptionContainer}>
              <ThemedText style={styles.description}>
                {decode(book.description || "No description available")}
              </ThemedText>
            </View>

            {/* Source Button */}
            {book.sourceUrl && (
              <Pressable
                style={styles.sourceButton}
                onPress={() => {
                  if (book.sourceUrl) {
                    Linking.openURL(book.sourceUrl);
                  }
                }}
              >
                <ThemedText style={styles.sourceButtonText}>
                  {book.source}
                </ThemedText>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    position: "relative",
    marginTop: 24,
    marginBottom: 56,
  },
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1,
    padding: 8,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    alignItems: "center",
    paddingTop: 56,
  },
  coverContainer: {
    marginTop: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cover: {
    width: 200,
    height: 300,
    borderRadius: 12,
  },
  infoContainer: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  author: {
    fontSize: 16,
    marginBottom: 12,
    opacity: 0.8,
    textAlign: "center",
  },
  ratingContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: "row",
    marginBottom: 4,
  },
  starWrapper: {
    width: 24,
    height: 24,
    position: "relative",
  },
  star: {
    position: "absolute",
    fontSize: 22,
  },
  starBackground: {
    color: "#D1D5DB",
  },
  starFilled: {
    color: "#FBBF24",
    overflow: "hidden",
  },
  ratingText: {
    fontSize: 14,
    opacity: 0.6,
  },
  statusButton: {
    flexDirection: "row",
    backgroundColor: "#4CAF50",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    marginVertical: 16,
    width: "80%",
    alignItems: "center",
    justifyContent: "center",
  },
  statusButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  descriptionContainer: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    width: "100%",
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "left",
  },
  sourceButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#4B5563",
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  sourceButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalView: {
    margin: 20,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "stretch",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: "80%",
    maxHeight: "50%",
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  modalOptionText: {
    fontSize: 16,
    textAlign: "center",
  },
  separator: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 15,
  },
  errorText: {
    color: "red",
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
  },
});
