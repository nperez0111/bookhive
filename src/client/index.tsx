import { render } from "hono/jsx/dom";
import { SearchBox } from "./components/SearchBox";

document.addEventListener("DOMContentLoaded", () => {
  const mountSearchBox = document.getElementById("mount-search-box");
  if (mountSearchBox) {
    render(<SearchBox />, mountSearchBox);
  }
});
