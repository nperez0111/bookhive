import { render } from "hono/jsx/dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchBox } from "./components/SearchBox";
import { StarRating } from "./components/StarRating";

const queryClient = new QueryClient();

document.addEventListener("DOMContentLoaded", () => {
  const mountSearchBox = document.getElementById("mount-search-box");
  if (mountSearchBox) {
    render(
      // Provide the client to your App
      <QueryClientProvider client={queryClient}>
        <SearchBox />
      </QueryClientProvider>,
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
});
