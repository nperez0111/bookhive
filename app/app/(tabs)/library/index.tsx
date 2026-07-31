import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/ActionSheet";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookSearchModal } from "@/components/BookSearchModal";
import { PersonalBookCard } from "@/components/PersonalBookCard";
import { ProgressBar } from "@/components/ProgressBar";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { TextPromptModal } from "@/components/TextPromptModal";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import {
  useAddToPersonalShelf,
  useCreatePersonalShelf,
  useDeletePersonalBook,
  useDeletePersonalShelf,
  useDeleteSyncDocument,
  useDismissSyncDocument,
  useLinkPersonalBook,
  useLinkSyncDocument,
  usePersonalLibrary,
  usePersonalShelves,
  useRemoveFromPersonalShelf,
  useRenameSyncDocument,
  useSyncDocuments,
  useUnlinkPersonalBook,
  useUpdatePersonalShelf,
  useUploadPersonalBook,
  type PersonalBook,
  type PersonalShelf,
  type SyncDoc,
} from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { formatAuthors, progressFraction } from "@/utils/personalLibrary";
import type { HiveBook } from "../../../../src/types";

/** Mirrors the formats the upload route accepts (`ACCEPTED_EXTENSIONS`). */
const ACCEPTED_EXTENSIONS = ["epub", "mobi", "azw", "azw3", "fb2", "cbz"];

/** A prompt that's open, and what to do with the text it collects. */
type Prompt = {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  maxLength?: number;
  onSubmit: (value: string) => void;
};

/** Which entity the book picker is currently matching. */
type MatchTarget = { kind: "book"; book: PersonalBook } | { kind: "document"; document: SyncDoc };

function documentTitle(doc: SyncDoc): string {
  return doc.title || doc.filename || "Untitled document";
}

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { top } = useSafeAreaInsets();

  const [activeShelfId, setActiveShelfId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  const [bookSheet, setBookSheet] = useState<PersonalBook | null>(null);
  const [shelfPickerFor, setShelfPickerFor] = useState<PersonalBook | null>(null);
  const [docSheet, setDocSheet] = useState<SyncDoc | null>(null);
  const [shelfSheet, setShelfSheet] = useState<PersonalShelf | null>(null);
  const [matchTarget, setMatchTarget] = useState<MatchTarget | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  // The unfiltered query backs the "All books" count; when no shelf is active
  // it shares a cache key with the grid query, so it costs nothing extra.
  const allBooksQuery = usePersonalLibrary(undefined);
  const libraryQuery = usePersonalLibrary(activeShelfId ?? undefined);
  const shelvesQuery = usePersonalShelves();
  const documentsQuery = useSyncDocuments();

  const upload = useUploadPersonalBook();
  const deleteBook = useDeletePersonalBook();
  const linkBook = useLinkPersonalBook();
  const unlinkBook = useUnlinkPersonalBook();
  const createShelf = useCreatePersonalShelf();
  const updateShelf = useUpdatePersonalShelf();
  const deleteShelf = useDeletePersonalShelf();
  const addToShelf = useAddToPersonalShelf();
  const removeFromShelf = useRemoveFromPersonalShelf();
  const linkDocument = useLinkSyncDocument();
  const dismissDocument = useDismissSyncDocument();
  const renameDocument = useRenameSyncDocument();
  const deleteDocument = useDeleteSyncDocument();

  const books = useMemo(
    () => libraryQuery.data?.pages.flatMap((page) => page.books) ?? [],
    [libraryQuery.data],
  );
  const totalBooks = allBooksQuery.data?.pages[0]?.total ?? 0;
  const shelves = shelvesQuery.data ?? [];
  const documents = documentsQuery.data ?? [];

  // A document whose content hash matches an upload is already on screen as a
  // grid card, so the sync sections only cover documents with no file.
  const looseDocuments = useMemo(() => documents.filter((doc) => !doc.hasFile), [documents]);
  const needsTriage = useMemo(
    () => looseDocuments.filter((doc) => !doc.hiveId && !doc.dismissed),
    [looseDocuments],
  );
  const tracked = useMemo(
    () => looseDocuments.filter((doc) => doc.hiveId || doc.dismissed),
    [looseDocuments],
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([
      libraryQuery.refetch(),
      allBooksQuery.refetch(),
      shelvesQuery.refetch(),
      documentsQuery.refetch(),
    ]).finally(() => setIsRefreshing(false));
  }, [libraryQuery.refetch, allBooksQuery.refetch, shelvesQuery.refetch, documentsQuery.refetch]);

  // ── Upload ──

  const handleUpload = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      // iOS reports no useful MIME type for most ebook formats, so accept
      // everything and check the extension ourselves — a clear message beats a
      // picker that greys out valid files.
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    const extension = asset.name.toLowerCase().split(".").pop() ?? "";
    if (
      !ACCEPTED_EXTENSIONS.includes(extension) &&
      !asset.name.toLowerCase().endsWith(".fb2.zip")
    ) {
      Alert.alert(
        "Unsupported file",
        `BookHive accepts ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")} files.`,
      );
      return;
    }

    setUploadName(asset.name);
    setUploadProgress(0);
    upload.mutate(
      {
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType,
        onProgress: setUploadProgress,
      },
      {
        onSuccess: ({ book }) => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (!book.hiveId) {
            // Nothing matched in the catalog, so offer the match right away
            // rather than leaving an unlinked file for the user to find later.
            setMatchTarget({ kind: "book", book });
          }
        },
        onError: (error: Error) => Alert.alert("Upload failed", error.message),
        onSettled: () => {
          setUploadProgress(null);
          setUploadName(null);
        },
      },
    );
  }, [upload]);

  // ── Book actions ──

  const confirmDeleteBook = useCallback(
    (book: PersonalBook) => {
      // deletePersonalBook drops the file and personal_book row but leaves
      // sync_document alone, so a book with e-reader progress doesn't vanish —
      // it loses its file and reappears in the sync sections. Say so.
      Alert.alert(
        "Delete this file?",
        `“${book.title}” will be removed from your library and your OPDS catalog.` +
          (book.progress
            ? " Your e-reader progress is kept and moves down to “Also tracking”."
            : "") +
          " Your BookHive reading record isn't affected.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () =>
              deleteBook.mutate(
                { contentHash: book.contentHash },
                { onError: () => Alert.alert("Couldn't delete", "Please try again.") },
              ),
          },
        ],
      );
    },
    [deleteBook],
  );

  const bookActions = useMemo((): SheetAction[] => {
    const book = bookSheet;
    if (!book) return [];
    const actions: SheetAction[] = [];
    // Two independent axes decide what's on offer: whether the file is linked
    // to a catalog entry, and whether an e-reader has reported progress for it
    // (a sync_document sharing its content hash). They mean different things
    // and the labels have to keep them apart.
    const percent = book.progress
      ? Math.round(progressFraction(book.progress.percentage) * 100)
      : null;

    if (book.hiveId) {
      actions.push({
        key: "open",
        label: "View on BookHive",
        icon: "open-outline",
        onPress: () => {
          setBookSheet(null);
          router.push(`/book/${book.hiveId}` as any);
        },
      });
    }
    actions.push({
      key: "link",
      label: book.hiveId ? "Link to a different book" : "Link to a BookHive book",
      icon: "search",
      // Only claim what the call actually does. Linking a file rewrites its
      // title/author from the catalog and marks the book owned; it moves
      // reading progress only when there is progress to move.
      description:
        percent !== null
          ? `Uses the catalog's details and moves your ${percent}% onto that book`
          : "Uses the catalog's title, author and cover",
      onPress: () => {
        setBookSheet(null);
        setMatchTarget({ kind: "book", book });
      },
    });
    if (book.hiveId) {
      actions.push({
        key: "unlink",
        label: "Unlink from BookHive",
        icon: "unlink",
        description:
          percent !== null
            ? "Keeps the file and its e-reader progress"
            : "Keeps the file, drops the catalog details",
        busy: unlinkBook.isPending,
        onPress: () => {
          setBookSheet(null);
          unlinkBook.mutate({ contentHash: book.contentHash });
        },
      });
    }
    actions.push({
      key: "shelves",
      label: "Shelves",
      icon: "albums",
      description: book.shelfIds?.length
        ? `On ${book.shelfIds.length} ${book.shelfIds.length === 1 ? "shelf" : "shelves"}`
        : "Not on a shelf yet",
      onPress: () => {
        setBookSheet(null);
        setShelfPickerFor(book);
      },
    });
    actions.push({
      key: "delete",
      label: "Delete file",
      icon: "trash",
      destructive: true,
      onPress: () => {
        setBookSheet(null);
        confirmDeleteBook(book);
      },
    });
    return actions;
  }, [bookSheet, unlinkBook, confirmDeleteBook]);

  const shelfPickerActions = useMemo((): SheetAction[] => {
    const book = shelfPickerFor;
    if (!book) return [];
    const memberships = new Set(book.shelfIds ?? []);
    return [
      ...shelves.map((shelf) => ({
        key: `shelf-${shelf.id}`,
        label: shelf.name,
        icon: (memberships.has(shelf.id)
          ? "checkmark-circle"
          : "ellipse-outline") as SheetAction["icon"],
        description: `${shelf.bookCount} ${shelf.bookCount === 1 ? "book" : "books"}`,
        onPress: () => {
          setShelfPickerFor(null);
          const input = { shelfId: shelf.id, contentHash: book.contentHash };
          if (memberships.has(shelf.id)) removeFromShelf.mutate(input);
          else addToShelf.mutate(input);
        },
      })),
      {
        key: "new-shelf",
        label: "New shelf…",
        icon: "add-circle-outline" as SheetAction["icon"],
        onPress: () => {
          setShelfPickerFor(null);
          setPrompt({
            title: "New shelf",
            label: "Name",
            placeholder: "e.g. Sci-fi",
            submitLabel: "Create shelf",
            onSubmit: (name) =>
              createShelf.mutate(
                { name },
                {
                  onSuccess: ({ shelf }) => {
                    setPrompt(null);
                    addToShelf.mutate({ shelfId: shelf.id, contentHash: book.contentHash });
                  },
                  onError: () => Alert.alert("Couldn't create shelf", "Please try again."),
                },
              ),
          });
        },
      },
    ];
  }, [shelfPickerFor, shelves, addToShelf, removeFromShelf, createShelf]);

  // ── Shelf actions ──

  const openNewShelfPrompt = useCallback(() => {
    setPrompt({
      title: "New shelf",
      label: "Name",
      placeholder: "e.g. Sci-fi",
      submitLabel: "Create shelf",
      onSubmit: (name) =>
        createShelf.mutate(
          { name },
          {
            onSuccess: ({ shelf }) => {
              setPrompt(null);
              setActiveShelfId(shelf.id);
            },
            onError: () => Alert.alert("Couldn't create shelf", "Please try again."),
          },
        ),
    });
  }, [createShelf]);

  const shelfActions = useMemo((): SheetAction[] => {
    const shelf = shelfSheet;
    if (!shelf) return [];
    return [
      {
        key: "rename",
        label: "Rename shelf",
        icon: "create-outline",
        onPress: () => {
          setShelfSheet(null);
          setPrompt({
            title: "Rename shelf",
            label: "Name",
            initialValue: shelf.name,
            submitLabel: "Save",
            onSubmit: (name) =>
              updateShelf.mutate(
                { id: shelf.id, name },
                {
                  onSuccess: () => setPrompt(null),
                  onError: () => Alert.alert("Couldn't rename", "Please try again."),
                },
              ),
          });
        },
      },
      {
        key: "delete",
        label: "Delete shelf",
        icon: "trash",
        description: "The books stay in your library",
        destructive: true,
        onPress: () => {
          setShelfSheet(null);
          Alert.alert("Delete shelf?", `“${shelf.name}” will be removed. Your files stay put.`, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                if (activeShelfId === shelf.id) setActiveShelfId(null);
                deleteShelf.mutate({ id: shelf.id });
              },
            },
          ]);
        },
      },
    ];
  }, [shelfSheet, updateShelf, deleteShelf, activeShelfId]);

  // ── Synced document actions ──

  const documentActions = useMemo((): SheetAction[] => {
    const doc = docSheet;
    if (!doc) return [];
    const actions: SheetAction[] = [];

    if (doc.hiveId) {
      actions.push({
        key: "open",
        label: "View on BookHive",
        icon: "open-outline",
        onPress: () => {
          setDocSheet(null);
          router.push(`/book/${doc.hiveId}` as any);
        },
      });
    }
    actions.push({
      key: "match",
      label: doc.hiveId ? "Link to a different book" : "Link to a BookHive book",
      icon: "search",
      onPress: () => {
        setDocSheet(null);
        setMatchTarget({ kind: "document", document: doc });
      },
    });
    if (!doc.hiveId) {
      actions.push({
        key: "dismiss",
        label: doc.dismissed ? "Look for a match again" : "Not on BookHive",
        icon: doc.dismissed ? "refresh" : "eye-off-outline",
        description: doc.dismissed ? undefined : "Stops asking about this document",
        onPress: () => {
          setDocSheet(null);
          dismissDocument.mutate({ document: doc.document, dismissed: !doc.dismissed });
        },
      });
    }
    actions.push({
      key: "rename",
      label: "Rename",
      icon: "create-outline",
      onPress: () => {
        setDocSheet(null);
        setPrompt({
          title: "Rename document",
          message: "Only changes how it's labelled here.",
          label: "Title",
          initialValue: doc.title ?? "",
          placeholder: doc.filename ?? "Title",
          submitLabel: "Save",
          maxLength: 300,
          onSubmit: (title) =>
            renameDocument.mutate(
              { document: doc.document, title },
              {
                onSuccess: () => setPrompt(null),
                onError: () => Alert.alert("Couldn't rename", "Please try again."),
              },
            ),
        });
      },
    });
    actions.push({
      key: "forget",
      label: "Forget document",
      icon: "trash",
      description: "Discards the e-reader progress we hold for it",
      destructive: true,
      onPress: () => {
        setDocSheet(null);
        Alert.alert(
          "Forget this document?",
          "BookHive drops the e-reader progress it holds for it. Your own reading record stays. It comes back if the device syncs it again.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Forget",
              style: "destructive",
              onPress: () => deleteDocument.mutate({ document: doc.document }),
            },
          ],
        );
      },
    });
    return actions;
  }, [docSheet, dismissDocument, renameDocument, deleteDocument]);

  const handleSelectMatch = useCallback(
    (hiveBook: HiveBook) => {
      if (!matchTarget) return;
      const onError = () => Alert.alert("Couldn't link", "Something went wrong. Please try again.");
      const onSuccess = () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMatchTarget(null);
      };

      if (matchTarget.kind === "book") {
        const book = matchTarget.book;
        linkBook.mutate(
          { contentHash: book.contentHash, hiveId: hiveBook.id },
          {
            onSuccess: () => {
              // linkPersonalBook associates the file and rewrites its metadata,
              // but it never touches user_book.bookProgress. If an e-reader has
              // been reporting progress for this file, the second call is what
              // actually gets that percentage onto the user's BookHive record
              // (and queues the PDS write). The document hash and the file's
              // content hash are the same KOReader partial MD5.
              if (book.progress) {
                linkDocument.mutate(
                  { document: book.contentHash, hiveId: hiveBook.id },
                  { onSuccess, onError },
                );
              } else {
                onSuccess();
              }
            },
            onError,
          },
        );
      } else {
        linkDocument.mutate(
          { document: matchTarget.document.document, hiveId: hiveBook.id },
          { onSuccess, onError },
        );
      }
    },
    [matchTarget, linkBook, linkDocument],
  );

  // ── Rendering ──

  // Onboarding replaces the grid only once every source has reported in —
  // otherwise a slow shelves/documents fetch flashes "your library is empty"
  // at someone who has both.
  const isEmpty =
    !libraryQuery.isLoading &&
    !shelvesQuery.isLoading &&
    !documentsQuery.isLoading &&
    totalBooks === 0 &&
    shelves.length === 0 &&
    documents.length === 0;

  const renderShelfTabs = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.shelfTabs}
    >
      <ShelfPill
        label="All books"
        count={totalBooks}
        active={activeShelfId === null}
        onPress={() => setActiveShelfId(null)}
      />
      {shelves.map((shelf) => (
        <ShelfPill
          key={shelf.id}
          label={shelf.name}
          count={shelf.bookCount}
          active={activeShelfId === shelf.id}
          onPress={() => setActiveShelfId(shelf.id)}
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShelfSheet(shelf);
          }}
        />
      ))}
      <Pressable
        onPress={openNewShelfPrompt}
        style={[styles.pill, styles.pillNew, { borderColor: colors.cardBorder }]}
        accessibilityLabel="New shelf"
      >
        <Ionicons name="add" size={16} color={colors.primary} />
        <ThemedText type="label" style={{ color: colors.primary }}>
          Shelf
        </ThemedText>
      </Pressable>
    </ScrollView>
  );

  const renderHeader = () => (
    <View>
      {renderShelfTabs()}

      {needsTriage.length > 0 ? (
        <View
          style={[
            styles.triage,
            { borderColor: colors.primary, backgroundColor: colors.activeBackground },
          ]}
        >
          <View style={styles.triageHeader}>
            <Ionicons name="sync-circle" size={20} color={colors.primary} />
            <View style={styles.triageHeaderText}>
              <ThemedText type="label" style={{ color: colors.primaryText }}>
                {needsTriage.length} from your e-reader
              </ThemedText>
              <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                Link them so progress lands on the right book
              </ThemedText>
            </View>
          </View>

          {needsTriage.map((doc, index) => (
            <AnimatedListItem key={doc.document} index={index}>
              <View style={[styles.triageRow, { borderTopColor: colors.cardBorder }]}>
                <View style={styles.triageRowText}>
                  <ThemedText type="label" style={{ color: colors.primaryText }} numberOfLines={1}>
                    {documentTitle(doc)}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                    {[
                      `${Math.round(progressFraction(doc.percentage) * 100)}%`,
                      formatAuthors(doc.authors) || doc.device,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setMatchTarget({ kind: "document", document: doc })}
                  style={[styles.matchButton, { backgroundColor: colors.primary }]}
                >
                  <ThemedText type="caption" style={styles.matchButtonText}>
                    Link
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setDocSheet(doc)}
                  hitSlop={8}
                  accessibilityLabel={`More actions for ${documentTitle(doc)}`}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.secondaryText} />
                </Pressable>
              </View>
            </AnimatedListItem>
          ))}
        </View>
      ) : null}

      {books.length > 0 || libraryQuery.isLoading ? null : (
        <View style={styles.shelfEmpty}>
          <ThemedText type="body" style={{ color: colors.secondaryText, textAlign: "center" }}>
            {activeShelfId === null
              ? "No files uploaded yet."
              : "Nothing on this shelf yet. Open a book's actions to add it."}
          </ThemedText>
        </View>
      )}
    </View>
  );

  const renderFooter = () => (
    <View>
      {libraryQuery.hasNextPage ? (
        <Pressable
          onPress={() => libraryQuery.fetchNextPage()}
          disabled={libraryQuery.isFetchingNextPage}
          style={[styles.loadMore, { borderColor: colors.cardBorder }]}
        >
          {libraryQuery.isFetchingNextPage ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <ThemedText type="label" style={{ color: colors.primary }}>
              Load more
            </ThemedText>
          )}
        </Pressable>
      ) : null}

      {tracked.length > 0 ? (
        <View style={styles.trackedSection}>
          <ThemedText
            type="overline"
            style={[styles.trackedTitle, { color: colors.secondaryText }]}
          >
            Also tracking
          </ThemedText>
          <ThemedText type="caption" style={{ color: colors.tertiaryText, marginBottom: 12 }}>
            Synced from your e-reader with no file uploaded here.
          </ThemedText>
          {tracked.map((doc) => (
            <Pressable
              key={doc.document}
              onPress={() => setDocSheet(doc)}
              style={({ pressed }) => [
                styles.trackedRow,
                {
                  borderColor: colors.cardBorder,
                  backgroundColor: pressed ? colors.activeBackground : colors.cardBackground,
                },
              ]}
            >
              <View
                style={[
                  styles.trackedIcon,
                  {
                    backgroundColor: doc.dismissed
                      ? colors.inactiveBackground
                      : colors.activeBackground,
                  },
                ]}
              >
                <Ionicons
                  name={doc.dismissed ? "remove-circle-outline" : "link"}
                  size={16}
                  color={doc.dismissed ? colors.tertiaryText : colors.primary}
                />
              </View>
              <View style={styles.trackedText}>
                <ThemedText type="label" style={{ color: colors.primaryText }} numberOfLines={1}>
                  {documentTitle(doc)}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: colors.secondaryText }}
                  numberOfLines={1}
                >
                  {doc.dismissed
                    ? "Not on BookHive"
                    : `${Math.round(progressFraction(doc.percentage) * 100)}% · ${doc.bookTitle ?? "Linked"}`}
                </ThemedText>
              </View>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.tertiaryText} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <BackNavigationHeader
        title="My Library"
        style={{ paddingTop: top + 8 }}
        rightElement={
          <Pressable
            onPress={handleUpload}
            disabled={upload.isPending}
            hitSlop={8}
            accessibilityLabel="Upload a book"
          >
            {upload.isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="add-circle" size={28} color={colors.primary} />
            )}
          </Pressable>
        }
      />

      {uploadProgress !== null ? (
        <View
          style={[
            styles.uploadStrip,
            { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.uploadStripHeader}>
            <ThemedText type="caption" style={{ color: colors.secondaryText }} numberOfLines={1}>
              Uploading {uploadName}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.primary }}>
              {Math.round(uploadProgress * 100)}%
            </ThemedText>
          </View>
          <ProgressBar value={uploadProgress} height={4} />
        </View>
      ) : null}

      {libraryQuery.isLoading && books.length === 0 && !isRefreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : libraryQuery.error && books.length === 0 ? (
        <QueryErrorHandler
          error={libraryQuery.error}
          onRetry={() => libraryQuery.refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : isEmpty ? (
        <ScrollView
          contentContainerStyle={[styles.emptyState, { paddingBottom: 32 + bottom }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <View style={[styles.emptyIcon, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="library-outline" size={40} color={colors.tertiaryText} />
          </View>
          <ThemedText type="heading" style={[styles.emptyTitle, { color: colors.primaryText }]}>
            Your library is empty
          </ThemedText>
          <ThemedText type="body" style={[styles.emptyBody, { color: colors.secondaryText }]}>
            Upload your ebooks to read them on any e-reader through BookHive&apos;s OPDS catalog,
            and connect KOReader so your reading progress syncs back here.
          </ThemedText>
          <Pressable
            onPress={handleUpload}
            disabled={upload.isPending}
            style={[styles.primaryCta, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
            <ThemedText type="label" style={styles.primaryCtaText}>
              Upload a book
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => router.push("/sync" as any)}
            style={[styles.secondaryCta, { borderColor: colors.cardBorder }]}
          >
            <Ionicons name="sync" size={18} color={colors.primary} />
            <ThemedText type="label" style={{ color: colors.primary }}>
              Connect your e-reader
            </ThemedText>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.contentHash}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.listContent, { paddingBottom: 32 + bottom }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader()}
          ListFooterComponent={renderFooter()}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (libraryQuery.hasNextPage && !libraryQuery.isFetchingNextPage) {
              void libraryQuery.fetchNextPage();
            }
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item, index }) => (
            // The cell caps its own width so a lone item on a final odd row
            // stays column-sized instead of stretching across the grid.
            <View style={styles.gridCell}>
              <AnimatedListItem index={index % 8}>
                <PersonalBookCard book={item} onPress={() => setBookSheet(item)} />
              </AnimatedListItem>
            </View>
          )}
        />
      )}

      <ActionSheet
        visible={Boolean(bookSheet)}
        onClose={() => setBookSheet(null)}
        title={bookSheet?.title}
        // Name the two states the actions branch on — linked or not, synced or
        // not — so the option labels below have visible context.
        subtitle={
          bookSheet
            ? [
                formatAuthors(bookSheet.authors),
                bookSheet.progress
                  ? `${Math.round(progressFraction(bookSheet.progress.percentage) * 100)}% read${
                      bookSheet.progress.device ? ` on ${bookSheet.progress.device}` : ""
                    }`
                  : null,
                bookSheet.hiveId ? "Linked to BookHive" : "Not linked",
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={bookActions}
      />
      <ActionSheet
        visible={Boolean(shelfPickerFor)}
        onClose={() => setShelfPickerFor(null)}
        title="Shelves"
        subtitle={shelfPickerFor?.title}
        actions={shelfPickerActions}
      />
      <ActionSheet
        visible={Boolean(shelfSheet)}
        onClose={() => setShelfSheet(null)}
        title={shelfSheet?.name}
        subtitle={
          shelfSheet
            ? `${shelfSheet.bookCount} ${shelfSheet.bookCount === 1 ? "book" : "books"}`
            : undefined
        }
        actions={shelfActions}
      />
      <ActionSheet
        visible={Boolean(docSheet)}
        onClose={() => setDocSheet(null)}
        title={docSheet ? documentTitle(docSheet) : undefined}
        subtitle={docSheet?.device ?? undefined}
        actions={documentActions}
      />

      <BookSearchModal
        visible={Boolean(matchTarget)}
        onClose={() => setMatchTarget(null)}
        onSelectBook={handleSelectMatch}
        isLinking={linkBook.isPending || linkDocument.isPending}
        subjectTitle={
          matchTarget?.kind === "book"
            ? matchTarget.book.title
            : matchTarget
              ? documentTitle(matchTarget.document)
              : undefined
        }
        initialQuery={
          matchTarget?.kind === "book"
            ? matchTarget.book.title
            : matchTarget
              ? (matchTarget.document.title ?? "")
              : ""
        }
      />

      <TextPromptModal
        visible={Boolean(prompt)}
        title={prompt?.title ?? ""}
        message={prompt?.message}
        label={prompt?.label}
        placeholder={prompt?.placeholder}
        initialValue={prompt?.initialValue}
        submitLabel={prompt?.submitLabel}
        maxLength={prompt?.maxLength}
        busy={createShelf.isPending || updateShelf.isPending || renameDocument.isPending}
        onClose={() => setPrompt(null)}
        onSubmit={(value) => prompt?.onSubmit(value)}
      />
    </ThemedView>
  );
}

function ShelfPill({
  label,
  count,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.pill,
        {
          backgroundColor: active ? colors.primary : colors.cardBackground,
          borderColor: active ? colors.primary : colors.cardBorder,
        },
      ]}
    >
      <ThemedText type="label" style={{ color: active ? "#fff" : colors.primaryText }}>
        {label}
      </ThemedText>
      <ThemedText
        type="caption"
        style={{ color: active ? "rgba(255,255,255,0.8)" : colors.tertiaryText }}
      >
        {count}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadStrip: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  uploadStripHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  gridRow: {
    gap: 12,
    marginBottom: 20,
  },
  gridCell: {
    flex: 1,
    maxWidth: "48%",
  },
  shelfTabs: {
    gap: 8,
    paddingVertical: 4,
    paddingBottom: 16,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillNew: {
    borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  triage: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
  },
  triageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 8,
  },
  triageHeaderText: {
    flex: 1,
    gap: 1,
  },
  triageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  triageRowText: {
    flex: 1,
    gap: 1,
  },
  matchButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  matchButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  shelfEmpty: {
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  loadMore: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 24,
  },
  trackedSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  trackedTitle: {
    marginBottom: 2,
  },
  trackedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  trackedIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  trackedText: {
    flex: 1,
    gap: 1,
  },
  emptyState: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyBody: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 12,
  },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
  },
  primaryCtaText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
});
