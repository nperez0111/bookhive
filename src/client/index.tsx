import { render } from "hono/jsx/dom";
import "basecoat-css/sidebar";
import "../index.css";

import { SearchTrigger } from "./components/SearchBox";
import { SearchPalette } from "./components/SearchPalette";
import { StarRating } from "./components/StarRating";
import { ImportTableApp } from "./components/import/ImportTableApp";

document.addEventListener("DOMContentLoaded", () => {
  // Shared open function: SearchPalette registers it, SearchTrigger calls it
  let openPalette: (() => void) | null = null;

  const mountSearchBox = document.getElementById("mount-search-box");
  if (mountSearchBox) {
    render(<SearchTrigger onOpen={() => openPalette?.()} />, mountSearchBox);
  }

  const mountSearchPalette = document.getElementById("mount-search-palette");
  if (mountSearchPalette) {
    const isLoggedIn = mountSearchPalette.dataset["loggedIn"] === "true";
    render(
      <SearchPalette
        isLoggedIn={isLoggedIn}
        onRegisterOpen={(fn) => {
          openPalette = fn;
        }}
      />,
      mountSearchPalette,
    );
  }

  const starRating = document.getElementById("star-rating");
  if (starRating) {
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
  }

  const importTable = document.getElementById("import-table");
  if (importTable) {
    render(<ImportTableApp />, importTable);
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
