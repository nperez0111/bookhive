import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

import { ActionSheet, type SheetAction } from "@/components/ActionSheet";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookSearchModal } from "@/components/BookSearchModal";
import { PersonalBookCard } from "@/components/PersonalBookCard";
import { ProgressBar } from "@/components/ProgressBar";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { StorageMeter } from "@/components/StorageMeter";
import { TextPromptModal } from "@/components/TextPromptModal";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { ThemedView } from "@/components/ThemedView";
import { ListItem } from "@/components/ListItem";
import { useEbookUpload } from "@/components/ebooks/useEbookUpload";
import { SyncDocumentTriage, TrackedSyncDocuments } from "@/components/ebooks/SyncDocumentSections";
import { SyncProgressPicker } from "@/components/ebooks/SyncProgressPicker";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { authSession } from "@/context/auth";
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
  storageFromLibrary,
  type PersonalBook,
  type PersonalShelf,
  type SyncDoc,
} from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { formatAuthors, formatFileSize, progressFraction } from "@/utils/personalLibrary";
import type { HiveBook } from "../../../src/types";
import type { PersonalLibrarySort } from "@/utils/personalLibraryQuery";
import { sharePersonalBook } from "@/utils/sharePersonalBook";
import { documentTitle, partitionSyncDocuments } from "@/utils/syncDocuments";
import { HeaderAction } from "@/components/HeaderAction";

/** A prompt that's open, and what to do with the text it collects. */
type Prompt = {
  id?: number;
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void | number>;
};

/** Which entity the book picker is currently matching. */
type MatchInput = { kind: "book"; book: PersonalBook } | { kind: "document"; document: SyncDoc };
type MatchTarget = MatchInput & {
  id: number;
  selection?: HiveBook;
  linkedHiveId?: string;
  error?: string;
};

class CreatedShelfError extends Error {}

export default function LibraryScreen() {
  const session = authSession.capture();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const top = useScreenTopInset();

  const [activeShelfId, setActiveShelfId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PersonalLibrarySort>("recent");
  const [exporting, setExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [bookSheet, setBookSheet] = useState<PersonalBook | null>(null);
  const [shelfPickerFor, setShelfPickerFor] = useState<PersonalBook | null>(null);
  const [docSheet, setDocSheet] = useState<SyncDoc | null>(null);
  const [shelfSheet, setShelfSheet] = useState<PersonalShelf | null>(null);
  const [matchTarget, setMatchTarget] = useState<MatchTarget | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const mounted = useRef(true);
  const promptGeneration = useRef(0);
  const promptWriting = useRef(false);
  const matching = useRef(false);
  const matchGeneration = useRef(0);
  const [promptBusy, setPromptBusy] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openMatch = useCallback((target: MatchInput) => {
    setMatchTarget({ ...target, id: ++matchGeneration.current });
  }, []);
  const closeMatch = () => {
    ++matchGeneration.current;
    setMatchTarget(null);
  };

  const openPrompt = useCallback(
    (input: Prompt) => {
      const generation = ++promptGeneration.current;
      setPrompt({
        ...input,
        id: generation,
        onSubmit: async (value) => {
          if (promptWriting.current || session.signal.aborted) return;
          promptWriting.current = true;
          setPromptBusy(true);
          try {
            const shelfId = await input.onSubmit(value);
            session.assertCurrent();
            if (mounted.current && generation === promptGeneration.current) {
              setPrompt(null);
              if (typeof shelfId === "number") setActiveShelfId(shelfId);
            }
          } catch (error) {
            if (
              mounted.current &&
              !session.signal.aborted &&
              generation === promptGeneration.current
            ) {
              if (error instanceof CreatedShelfError) setPrompt(null);
              Alert.alert(
                "Couldn't save",
                error instanceof Error ? error.message : "Please try again.",
              );
            }
          } finally {
            promptWriting.current = false;
            if (mounted.current) setPromptBusy(false);
          }
        },
      });
    },
    [session],
  );

  const closePrompt = () => {
    ++promptGeneration.current;
    setPrompt(null);
  };

  // The unfiltered query backs the "All books" count; when no shelf is active
  // it shares a cache key with the grid query, so it costs nothing extra.
  const allBooksQuery = usePersonalLibrary(undefined);
  const libraryQuery = usePersonalLibrary({ shelfId: activeShelfId ?? undefined, q: search, sort });
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

  const exportBook = useCallback(
    async (book: PersonalBook) => {
      setBookSheet(null);
      setExporting(true);
      try {
        await sharePersonalBook(book, session);
      } catch (error) {
        Alert.alert(
          "Couldn't open or save ebook",
          error instanceof Error ? error.message : "Please try again.",
        );
      } finally {
        setExporting(false);
      }
    },
    [session],
  );

  const actionError = [
    deleteBook,
    linkBook,
    unlinkBook,
    createShelf,
    updateShelf,
    deleteShelf,
    addToShelf,
    removeFromShelf,
    linkDocument,
    dismissDocument,
    renameDocument,
    deleteDocument,
  ].find((mutation) => mutation.error)?.error;

  const books = useMemo(
    () => libraryQuery.data?.pages.flatMap((page) => page.books) ?? [],
    [libraryQuery.data],
  );
  const totalBooks = allBooksQuery.data?.pages[0]?.total ?? 0;
  const shelves = useMemo(() => shelvesQuery.data ?? [], [shelvesQuery.data]);
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);

  // `quotaBytes <= 0` means the deployment has the quota switched off — treat
  // that as "no ceiling", never as "full".
  const storage = storageFromLibrary(allBooksQuery.data);
  const hasQuota = storage != null && storage.quotaBytes > 0;
  const isLibraryFull = hasQuota && storage.usedBytes >= storage.quotaBytes;
  const {
    handleUpload,
    uploadName,
    uploadProgress,
    isBusy: uploadBusy,
  } = useEbookUpload({
    storage,
    upload,
    onUnmatched: (book) => openMatch({ kind: "book", book }),
  });

  const { needsTriage, tracked } = useMemo(() => partitionSyncDocuments(documents), [documents]);

  const refetchLibrary = libraryQuery.refetch;
  const refetchAllBooks = allBooksQuery.refetch;
  const refetchShelves = shelvesQuery.refetch;
  const refetchDocuments = documentsQuery.refetch;
  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([
      refetchLibrary(),
      refetchAllBooks(),
      refetchShelves(),
      refetchDocuments(),
    ]).finally(() => setIsRefreshing(false));
  }, [refetchLibrary, refetchAllBooks, refetchShelves, refetchDocuments]);

  // ── Book actions ──

  const confirmDeleteBook = useCallback(
    (book: PersonalBook) => {
      // Deleting drops the file but not sync_document, so a book with e-reader
      // progress reappears in the sync sections instead of vanishing. Say so.
      Alert.alert(
        "Delete this file?",
        `“${book.title}” will be removed from your library and your OPDS catalog` +
          (book.sizeBytes ? `, freeing ${formatFileSize(book.sizeBytes)}` : "") +
          "." +
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
    actions.push({
      key: "export",
      label: "Open or save ebook…",
      description: "Download the file to share, save, or open in another app",
      icon: "download-outline",
      busy: exporting,
      onPress: () => {
        if (!exporting) void exportBook(book);
      },
    });
    // Whether the file is linked to a catalog entry and whether an e-reader has
    // reported progress for it are independent, and the labels keep them apart.
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
    // eslint-disable-next-line react-hooks/refs -- push stores an event callback; it never invokes it during render.
    actions.push({
      key: "link",
      label: book.hiveId ? "Link to a different book" : "Link to a BookHive book",
      icon: "search",
      // Only claim what the call actually does — it moves reading progress only
      // when there is progress to move.
      description:
        percent !== null
          ? `Links your ${percent}% progress; keeps the file's title, author and cover`
          : "Keeps the file's title, author and own cover",
      onPress: () => {
        setBookSheet(null);
        openMatch({ kind: "book", book });
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
            : "Keeps the file and its own metadata",
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
  }, [bookSheet, unlinkBook, confirmDeleteBook, exporting, exportBook, openMatch]);

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
          openPrompt({
            title: "New shelf",
            label: "Name",
            placeholder: "e.g. Sci-fi",
            submitLabel: "Create shelf",
            onSubmit: async (name) => {
              const { shelf } = await createShelf.mutateAsync({ name });
              session.assertCurrent();
              try {
                await addToShelf.mutateAsync({ shelfId: shelf.id, contentHash: book.contentHash });
              } catch (error) {
                throw new CreatedShelfError(
                  `Shelf “${shelf.name}” was created, but the ebook wasn't added. Open the book's Shelves action and select that shelf to retry. ${error instanceof Error ? error.message : ""}`,
                );
              }
            },
          });
        },
      },
    ];
  }, [shelfPickerFor, shelves, addToShelf, removeFromShelf, createShelf, openPrompt, session]);

  // ── Shelf actions ──

  const openNewShelfPrompt = useCallback(() => {
    openPrompt({
      title: "New shelf",
      label: "Name",
      placeholder: "e.g. Sci-fi",
      submitLabel: "Create shelf",
      onSubmit: async (name) => (await createShelf.mutateAsync({ name })).shelf.id,
    });
  }, [createShelf, openPrompt]);

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
          openPrompt({
            title: "Rename shelf",
            label: "Name",
            initialValue: shelf.name,
            submitLabel: "Save",
            onSubmit: async (name) => {
              await updateShelf.mutateAsync({ id: shelf.id, name });
            },
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
  }, [shelfSheet, updateShelf, deleteShelf, activeShelfId, openPrompt]);

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
    // eslint-disable-next-line react-hooks/refs -- push stores an event callback; it never invokes it during render.
    actions.push({
      key: "match",
      label: doc.hiveId ? "Link to a different book" : "Link to a BookHive book",
      icon: "search",
      onPress: () => {
        setDocSheet(null);
        openMatch({ kind: "document", document: doc });
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
    // eslint-disable-next-line react-hooks/refs -- push stores an event callback; it never invokes it during render.
    actions.push({
      key: "rename",
      label: "Rename",
      icon: "create-outline",
      onPress: () => {
        setDocSheet(null);
        openPrompt({
          title: "Rename document",
          message: "Only changes how it's labelled here.",
          label: "Title",
          initialValue: doc.title ?? "",
          placeholder: doc.filename ?? "Title",
          submitLabel: "Save",
          maxLength: 300,
          onSubmit: async (title) => {
            await renameDocument.mutateAsync({ document: doc.document, title });
          },
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
  }, [docSheet, dismissDocument, renameDocument, deleteDocument, openMatch, openPrompt]);

  const runMatch = async (target: MatchTarget, hiveBook: HiveBook, document?: SyncDoc) => {
    if (matching.current || session.signal.aborted) return;
    matching.current = true;
    setMatchBusy(true);
    let fileLinked =
      target.linkedHiveId === hiveBook.id ||
      (target.kind === "book" && target.book.hiveId === hiveBook.id);
    const ownsOverlay = () =>
      mounted.current && !session.signal.aborted && matchGeneration.current === target.id;
    try {
      session.assertCurrent();
      if (target.kind === "book" && !fileLinked) {
        await linkBook.mutateAsync({ contentHash: target.book.contentHash, hiveId: hiveBook.id });
        fileLinked = true;
        session.assertCurrent();
        if (ownsOverlay())
          setMatchTarget((current) =>
            current?.id === target.id ? { ...current, linkedHiveId: hiveBook.id } : current,
          );
      }
      // Required continuation is awaited, not a mounted observer callback. Only the
      // user's chosen, server-returned document identity may cross this boundary.
      if (document) {
        session.assertCurrent();
        await linkDocument.mutateAsync({ document: document.document, hiveId: hiveBook.id });
      }
      session.assertCurrent();
      if (ownsOverlay()) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMatchTarget((current) => (current?.id === target.id ? null : current));
      }
    } catch (error) {
      if (ownsOverlay()) {
        const message = `${fileLinked ? "The file is linked. Moving progress failed; choose the document again to retry only progress. " : "Couldn't link. "}${error instanceof Error ? error.message : "Please try again."}`;
        if (target.selection)
          setMatchTarget((current) =>
            current?.id === target.id
              ? { ...current, error: message, linkedHiveId: fileLinked ? hiveBook.id : undefined }
              : current,
          );
        else Alert.alert("Couldn't link", message);
      }
    } finally {
      matching.current = false;
      if (mounted.current) setMatchBusy(false);
    }
  };

  const handleSelectMatch = (hiveBook: HiveBook) => {
    if (!matchTarget || matching.current) return;
    if (matchTarget.kind === "book" && matchTarget.book.progress) {
      setMatchTarget({ ...matchTarget, selection: hiveBook });
    } else {
      void runMatch(
        matchTarget,
        hiveBook,
        matchTarget.kind === "document" ? matchTarget.document : undefined,
      );
    }
  };

  // ── Rendering ──

  // Wait for every source to report in, or a slow fetch flashes "empty" at someone who has books.
  const isEmpty =
    !libraryQuery.isLoading &&
    !shelvesQuery.isLoading &&
    !documentsQuery.isLoading &&
    !allBooksQuery.isLoading &&
    !libraryQuery.error &&
    !allBooksQuery.error &&
    !shelvesQuery.error &&
    !documentsQuery.error &&
    !search &&
    activeShelfId === null &&
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
      <StorageMeter storage={storage} />

      {renderShelfTabs()}

      <View style={{ gap: 8, marginBottom: 16 }}>
        <ThemedTextInput
          accessibilityLabel="Search your ebooks by title or author"
          placeholder="Search title or author"
          value={searchText}
          maxLength={256}
          onChangeText={(value) => {
            setSearchText(value);
            if (!value.trim()) setSearch("");
          }}
          onSubmitEditing={() => setSearch(searchText.trim())}
          returnKeyType="search"
          autoCapitalize="none"
          style={{
            borderWidth: 1,
            borderColor: colors.cardBorder,
            borderRadius: 12,
            padding: 12,
            minHeight: 44,
          }}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSearch(searchText.trim())}
            style={[styles.pill, { borderColor: colors.cardBorder, minHeight: 40 }]}
          >
            <ThemedText type="label">Search</ThemedText>
          </Pressable>
          {searchText || search ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSearchText("");
                setSearch("");
              }}
              style={[styles.pill, { borderColor: colors.cardBorder, minHeight: 40 }]}
            >
              <ThemedText type="label">Clear</ThemedText>
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {(
            [
              ["recent", "Newest"],
              ["title", "Title A–Z"],
              ["author", "Author A–Z"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === value }}
              onPress={() => setSort(value)}
              style={[
                styles.pill,
                {
                  minHeight: 40,
                  borderColor: sort === value ? colors.primary : colors.cardBorder,
                  backgroundColor: sort === value ? colors.activeBackground : colors.cardBackground,
                },
              ]}
            >
              <ThemedText type="label">{label}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>
        <ThemedText type="caption" style={{ color: colors.secondaryText }}>
          {libraryQuery.data?.pages[0]?.total ?? books.length} matching ebooks
        </ThemedText>
      </View>

      {[libraryQuery, shelvesQuery, documentsQuery, allBooksQuery].map((query, index, queries) =>
        query.error &&
        queries.findIndex((candidate) => candidate.error === query.error) === index ? (
          <QueryErrorHandler
            key={index}
            error={query.error}
            onRetry={() => query.refetch()}
            showRetryButton
            showGoBackButton={false}
          />
        ) : null,
      )}
      {libraryQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
      ) : null}

      <SyncDocumentTriage
        documents={needsTriage}
        onMatch={(document) => openMatch({ kind: "document", document })}
        onActions={setDocSheet}
      />

      {books.length > 0 || libraryQuery.isLoading || libraryQuery.error ? null : (
        <View style={styles.shelfEmpty}>
          <ThemedText type="body" style={{ color: colors.secondaryText, textAlign: "center" }}>
            {search
              ? "No ebooks match this search. Try another title or author."
              : activeShelfId === null
                ? "No files uploaded yet."
                : "Nothing on this shelf yet. Open a book's actions to add it."}
          </ThemedText>
        </View>
      )}
    </View>
  );

  const renderFooter = () => (
    <View>
      <InfinitePaginationFooter {...libraryQuery} />

      <TrackedSyncDocuments documents={tracked} onActions={setDocSheet} />
    </View>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <BackNavigationHeader
        title="Ebooks"
        style={{ paddingTop: top + 8 }}
        rightElement={
          <HeaderAction
            onPress={handleUpload}
            disabled={uploadBusy}
            accessibilityLabel={isLibraryFull ? "Upload a book — library full" : "Upload a book"}
            // Dimmed, not disabled: pressing it explains that the library is
            // full, which a dead control can't.
            style={isLibraryFull ? styles.uploadFull : undefined}
          >
            {uploadBusy ? (
              <ActivityIndicator size="small" color={colors.accentForeground} />
            ) : (
              <Ionicons
                name="add"
                size={22}
                color={isLibraryFull ? colors.tertiaryText : colors.accentForeground}
              />
            )}
          </HeaderAction>
        }
      />

      <ListItem
        icon="sync"
        title="E-reader sync"
        subtitle="Connect KOReader or browse with OPDS"
        onPress={() => router.push("/sync" as any)}
        style={{ marginHorizontal: 16, marginBottom: 12 }}
      />

      {exporting ? (
        <View style={{ padding: 12, flexDirection: "row", gap: 8 }}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText>Preparing ebook…</ThemedText>
        </View>
      ) : null}
      {actionError ? (
        <View accessibilityRole="alert" style={{ padding: 12 }}>
          <ThemedText style={{ color: colors.error }}>{actionError.message}</ThemedText>
        </View>
      ) : null}

      {uploadProgress !== null ? (
        <View
          style={[
            styles.uploadStrip,
            { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.uploadStripHeader}>
            <ThemedText type="caption" style={{ color: colors.secondaryText }} numberOfLines={1}>
              {uploadProgress >= 1 ? "Processing" : "Uploading"} {uploadName}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.primary }}>
              {uploadProgress >= 1 ? "Waiting for server…" : `${Math.round(uploadProgress * 100)}%`}
            </ThemedText>
          </View>
          <ProgressBar value={uploadProgress} height={4} />
        </View>
      ) : null}

      {isEmpty ? (
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
            No ebook files yet
          </ThemedText>
          <ThemedText type="body" style={[styles.emptyBody, { color: colors.secondaryText }]}>
            Store your ebook files here, then download them or open them on your e-reader.
          </ThemedText>
          <Pressable
            onPress={handleUpload}
            accessibilityRole="button"
            accessibilityLabel="Upload a book"
            accessibilityState={{ disabled: uploadBusy, busy: uploadBusy }}
            disabled={uploadBusy}
            style={[styles.primaryCta, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="cloud-upload-outline" size={20} color={Colors.light.primaryText} />
            <ThemedText
              type="label"
              style={[styles.primaryCtaText, { color: Colors.light.primaryText }]}
            >
              Upload a book
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
            if (
              libraryQuery.hasNextPage &&
              !libraryQuery.isFetching &&
              !libraryQuery.isFetchNextPageError
            ) {
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
                bookSheet.filename,
                formatAuthors(bookSheet.authors),
                bookSheet.progress
                  ? `${Math.round(progressFraction(bookSheet.progress.percentage) * 100)}% read${
                      bookSheet.progress.device ? ` on ${bookSheet.progress.device}` : ""
                    }`
                  : null,
                bookSheet.hiveId ? "Linked to BookHive" : "Not linked",
                // Worth the space now that there is a quota: "which of these do
                // I delete to make room" is unanswerable without it.
                formatFileSize(bookSheet.sizeBytes),
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
        operationKey={matchTarget?.id}
        visible={Boolean(matchTarget && !matchTarget.selection)}
        onClose={closeMatch}
        onSelectBook={handleSelectMatch}
        isLinking={matchBusy}
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

      <SyncProgressPicker
        fileTitle={matchTarget?.kind === "book" ? matchTarget.book.title : ""}
        bookTitle={matchTarget?.selection?.title ?? ""}
        visible={Boolean(matchTarget?.selection)}
        documents={documents}
        loading={documentsQuery.isLoading}
        loadError={documentsQuery.error}
        error={matchTarget?.error}
        fileLinked={Boolean(matchTarget?.linkedHiveId)}
        busy={matchBusy}
        onRetry={() => {
          void documentsQuery.refetch();
        }}
        onClose={closeMatch}
        onSelect={(document) => {
          if (matchTarget?.selection) void runMatch(matchTarget, matchTarget.selection, document);
        }}
        onFileOnly={() => {
          if (matchTarget?.selection) void runMatch(matchTarget, matchTarget.selection);
        }}
      />

      <TextPromptModal
        operationKey={prompt?.id}
        visible={Boolean(prompt)}
        title={prompt?.title ?? ""}
        message={prompt?.message}
        label={prompt?.label}
        placeholder={prompt?.placeholder}
        initialValue={prompt?.initialValue}
        submitLabel={prompt?.submitLabel}
        maxLength={prompt?.maxLength}
        busy={promptBusy}
        onClose={closePrompt}
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
  uploadFull: {
    opacity: 0.6,
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
  shelfEmpty: {
    paddingVertical: 40,
    paddingHorizontal: 24,
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
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryCtaText: {
    fontWeight: "600",
  },
});
