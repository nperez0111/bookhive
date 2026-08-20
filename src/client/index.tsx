import { render } from "hono/jsx/dom";
import "basecoat-css/sidebar";
import "../index.css";

import { SearchTrigger } from "./components/SearchBox";

document.addEventListener("DOMContentLoaded", () => {
  // Shared open function: the SearchPalette registers it once lazily loaded,
  // and the (eager, lightweight) SearchTrigger calls it. The palette module is
  // only fetched on first open (click or ⌘K).
  let openPalette: (() => void) | null = null;
  let paletteLoading = false;
  let openRequested = false;

  const mountSearchPalette = document.getElementById("mount-search-palette");

  const loadPalette = () => {
    if (!mountSearchPalette || paletteLoading) return;
    paletteLoading = true;
    const isLoggedIn = mountSearchPalette.dataset["loggedIn"] === "true";
    void import("./components/SearchPalette").then(({ SearchPalette }) => {
      render(
        <SearchPalette
          isLoggedIn={isLoggedIn}
          onRegisterOpen={(fn) => {
            openPalette = fn;
            // Honor an open requested before the module finished loading.
            if (openRequested) {
              openRequested = false;
              fn();
            }
          }}
        />,
        mountSearchPalette,
      );
    });
  };

  const triggerOpen = () => {
    if (openPalette) {
      openPalette();
    } else {
      openRequested = true;
      loadPalette();
    }
  };

  const mountSearchBox = document.getElementById("mount-search-box");
  if (mountSearchBox) {
    render(<SearchTrigger onOpen={triggerOpen} />, mountSearchBox);
  }

  // ⌘K / Ctrl+K opens the palette. Handled here (not inside SearchPalette) so the
  // shortcut works before the palette module is lazily loaded on first open. Once
  // the palette is mounted it owns the shortcut (toggle), so this defers to it.
  if (mountSearchPalette) {
    document.addEventListener("keydown", (e) => {
      if (openPalette) return; // palette mounted → its own handler toggles
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        triggerOpen();
      }
    });
  }

  // /books/:id — status, owned, rating, review, progress, dates. One store,
  // three mounts; see components/book/index.tsx.
  const bookActions = document.getElementById("mount-book-actions");
  if (bookActions) {
    const props = JSON.parse(bookActions.dataset["props"] || "null");
    if (props) {
      void import("./components/book/index").then(({ mountBookIslands }) => {
        mountBookIslands(props);
      });
    }
  }

  const importTable = document.getElementById("import-table");
  if (importTable) {
    void import("./components/import/ImportTableApp").then(({ ImportTableApp }) => {
      render(<ImportTableApp />, importTable);
    });
  }

  const libraryTable = document.getElementById("mount-library-table");
  if (libraryTable) {
    const books = JSON.parse(libraryTable.dataset["books"] || "[]");
    void import("./components/LibraryTable").then(({ LibraryTable }) => {
      render(<LibraryTable initialBooks={books} />, libraryTable);
    });
  }

  const libraryManager = document.getElementById("mount-library-manager");
  if (libraryManager) {
    void import("./components/LibraryManager").then(({ LibraryManager }) => {
      render(<LibraryManager />, libraryManager);
    });
  }

  // NOTE: there used to be a block here that rewrote document.title from the checked
  // `input[name="tabs"]` label, commented "on home page". The home page has no such tabs — the
  // only thing that renders them is BookList (src/pages/components/book.tsx), used solely by
  // the profile page. So it only ever ran where it was wrong, replacing the server-rendered
  // "BookHive | @handle" with a shelf label on load: every profile page retitled itself
  // "BookHive | Want to Read 90". The tabs are a CSS-only toggle that never changes the URL,
  // so there is nothing for a title to track. Removed rather than rescoped.
});
