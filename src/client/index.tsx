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

  const starRating = document.getElementById("star-rating");
  if (starRating) {
    void import("./components/StarRating").then(({ StarRating }) => {
      render(
        <StarRating
          initialRating={Number(starRating.dataset["rating"]) || 0}
          onChange={(rating) => {
            const ratingInput = document.getElementById("rating-value") as HTMLInputElement;
            ratingInput.value = rating.toString();

            const ratingForm = document.getElementById("activity-form") as HTMLFormElement;

            ratingForm.submit();
          }}
        />,
        starRating,
      );
    });
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

  // Update page title based on active tab on home page
  const tabInputs = document.querySelectorAll('input[name="tabs"]');
  if (tabInputs.length > 0) {
    const updateTitle = () => {
      const activeTab = document.querySelector('input[name="tabs"]:checked') as HTMLInputElement;
      if (!activeTab) return;

      const baseTitle = "BookHive";

      // Find the corresponding label for this tab input
      const tabLabel = document.querySelector(`label[for="${activeTab.id}"]`) as HTMLLabelElement;
      const tabTitle = tabLabel ? tabLabel.textContent?.trim() || "Home" : "Home";

      document.title = `${baseTitle} | ${tabTitle}`;
    };

    // Set initial title based on checked tab
    updateTitle();

    // Listen for tab changes
    tabInputs.forEach((input) => {
      input.addEventListener("change", updateTitle);
    });
  }
});
