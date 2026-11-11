/** Compatibility exports for existing screens. Implementations belong to domain modules. */
export {
  useBookInfo,
  useUpdateBook,
  useDeleteBook,
  useUpdateComment,
  type BookUpdateInput,
} from "./queries/trackedBooks";
export {
  useLanguages,
  useSearchBooks,
  useExplore,
  useAuthorBooks,
  useGenreBooks,
} from "./queries/discovery";
export {
  useProfile,
  useFollow,
  useUnfollow,
  useFeed,
  useReadingStats,
  type FeedActivity,
  type FeedGroup,
} from "./queries/readers";
export {
  useUserLists,
  useListDetails,
  useCreateList,
  useUpdateList,
  useDeleteList,
  useAddToList,
  useRemoveFromList,
  useReorderList,
} from "./queries/catalogueLists";
export {
  usePersonalLibrary,
  storageFromLibrary,
  usePersonalShelves,
  useUploadPersonalBook,
  useDeletePersonalBook,
  useLinkPersonalBook,
  useUnlinkPersonalBook,
  useCreatePersonalShelf,
  useUpdatePersonalShelf,
  useDeletePersonalShelf,
  useAddToPersonalShelf,
  useRemoveFromPersonalShelf,
} from "./queries/personalLibrary";
export {
  useSyncDocuments,
  useSyncPassword,
  useRotateSyncPassword,
  useLinkSyncDocument,
  useDismissSyncDocument,
  useRenameSyncDocument,
  useDeleteSyncDocument,
} from "./queries/sync";
export type {
  PersonalBook,
  PersonalStorage,
  PersonalShelf,
  SyncDoc,
} from "@/api/personalLibraryTypes";
export { UploadError } from "@/api/uploadPersonalBook";
