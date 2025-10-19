import { render } from "hono/jsx/dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchBox } from "./components/SearchBox";
import { StarRating } from "./components/StarRating";
import { ImportTableApp } from "./components/import/ImportTableApp";

const queryClient = new QueryClient();
const ClientProvider = ({ children }: { children: any }): any =>
  QueryClientProvider({ client: queryClient, children });

document.addEventListener("DOMContentLoaded", () => {
  const mountSearchBox = document.getElementById("mount-search-box");
  if (mountSearchBox) {
    render(
      // Provide the client to your App
      <ClientProvider>
        <SearchBox />
      </ClientProvider>,
      mountSearchBox,
    );
  }

  const starRating = document.getElementById("star-rating");
  if (starRating) {
    render(
      <StarRating
        initialRating={Number(starRating.dataset["rating"]) || 0}
        onChange={(rating) => {
          const ratingInput = document.getElementById(
            "rating-value",
          ) as HTMLInputElement;
          ratingInput.value = rating.toString();

          const ratingForm = document.getElementById(
            "rating-form",
          ) as HTMLFormElement;

          ratingForm.submit();
        }}
      />,
      starRating,
    );
  }

  const importTable = document.getElementById("import-table");
  if (importTable) {
    render(
      <ClientProvider>
        <ImportTableApp />
      </ClientProvider>,
      importTable,
    );
  }

  // Update page title based on active tab on home page
  const tabInputs = document.querySelectorAll('input[name="tabs"]');
  if (tabInputs.length > 0) {
    const updateTitle = () => {
      const activeTab = document.querySelector(
        'input[name="tabs"]:checked',
      ) as HTMLInputElement;
      if (!activeTab) return;

      const baseTitle = "BookHive";

      // Find the corresponding label for this tab input
      const tabLabel = document.querySelector(
        `label[for="${activeTab.id}"]`,
      ) as HTMLLabelElement;
      const tabTitle = tabLabel
        ? tabLabel.textContent?.trim() || "Home"
        : "Home";

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
