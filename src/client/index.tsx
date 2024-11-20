import { render } from "hono/jsx/dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchBox } from "./components/SearchBox";

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
});
