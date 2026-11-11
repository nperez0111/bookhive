import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SyncDoc } from "@/api/personalLibraryTypes";
import { documentTitle, partitionSyncDocuments } from "@/utils/syncDocuments";
import { SyncDocumentTriage, TrackedSyncDocuments } from "../SyncDocumentSections";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: jest.requireActual<typeof import("react-native")>("react-native").View,
}));

const doc: SyncDoc = {
  document: "hash",
  title: "A synced book",
  authors: "A Writer",
  filename: "book.epub",
  percentage: 0.42,
  device: "KOReader",
  updatedAt: "2026-10-24",
  hiveId: null,
  bookTitle: null,
  dismissed: false,
  hasFile: false,
};

it("partitions file-backed, unmatched, linked and dismissed documents without duplication", () => {
  const linked = { ...doc, document: "linked", hiveId: "bk_test" };
  const dismissed = { ...doc, document: "dismissed", dismissed: true };
  expect(
    partitionSyncDocuments([{ ...doc, document: "file", hasFile: true }, doc, linked, dismissed]),
  ).toEqual({ needsTriage: [doc], tracked: [linked, dismissed] });
  expect(documentTitle({ ...doc, title: "" })).toBe("book.epub");
  expect(documentTitle({ ...doc, title: null, filename: null })).toBe("Untitled document");
});

it("routes matching and other actions to the exact unmatched document", () => {
  const onMatch = jest.fn();
  const onActions = jest.fn();
  render(<SyncDocumentTriage documents={[doc]} onMatch={onMatch} onActions={onActions} />);
  expect(screen.getByText("42% · A Writer")).toBeTruthy();
  fireEvent.press(screen.getByText("Link"));
  expect(onMatch).toHaveBeenCalledWith(doc);
  fireEvent.press(screen.getByLabelText("More actions for A synced book"));
  expect(onActions).toHaveBeenCalledWith(doc);
});

it("keeps dismissed and linked states distinct in the tracked section", () => {
  const dismissed = { ...doc, dismissed: true };
  const onActions = jest.fn();
  const view = render(<TrackedSyncDocuments documents={[dismissed]} onActions={onActions} />);
  expect(screen.getByText("Not on BookHive")).toBeTruthy();
  fireEvent.press(screen.getByText("A synced book"));
  expect(onActions).toHaveBeenCalledWith(dismissed);
  view.rerender(
    <TrackedSyncDocuments
      documents={[{ ...doc, hiveId: "bk_test", bookTitle: "Catalogue title" }]}
      onActions={onActions}
    />,
  );
  expect(screen.getByText("42% · Catalogue title")).toBeTruthy();
});
