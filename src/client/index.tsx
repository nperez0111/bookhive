import { render } from "hono/jsx/dom";
import "basecoat-css/sidebar";
import "../index.css";

import { SearchTrigger } from "./components/SearchBox";
import { boolAttr, island, jsonAttr, type Mount } from "./islands";
import type { LibraryBook } from "./components/LibraryTable";
import type { BookActionsProps } from "./components/book/userBookStore";

document.addEventListener("DOMContentLoaded", () => {
  // The SearchPalette registers this once lazily loaded; the eager SearchTrigger calls it. The palette module is only fetched on first open.
  let openPalette: (() => void) | null = null;
  let openRequested = false;

  const palette = island({
    id: "mount-search-palette",
    lazy: true,
    props: boolAttr("loggedIn"),
    load: () =>
      import("./components/SearchPalette").then(
        ({ SearchPalette }): Mount<boolean> =>
          (el, isLoggedIn) =>
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
              el,
            ),
      ),
  });

  const triggerOpen = () => {
    if (openPalette) {
      openPalette();
    } else {
      openRequested = true;
      palette.run();
    }
  };

  island({
    id: "mount-search-box",
    load: () =>
      Promise.resolve<Mount<void>>((el) => render(<SearchTrigger onOpen={triggerOpen} />, el)),
  });

  // Handled here (not inside SearchPalette) so the shortcut works before the palette module is lazily loaded; once mounted, the palette owns the shortcut and this defers to it.
  if (palette.present) {
    document.addEventListener("keydown", (e) => {
      if (openPalette) return; // palette mounted → its own handler toggles
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        triggerOpen();
      }
    });
  }

  // /books/:id — status, owned, rating, review, progress, dates. One store, three mounts; see components/book/index.tsx.
  island({
    id: "mount-book-actions",
    props: jsonAttr<BookActionsProps | null>("props", null),
    load: () =>
      import("./components/book/index").then(
        ({ mountBookIslands }): Mount<BookActionsProps | null> =>
          (_el, props) => {
            if (props) mountBookIslands(props);
          },
      ),
  });

  island({
    id: "import-table",
    load: () =>
      import("./components/import/ImportTableApp").then(
        ({ ImportTableApp }): Mount<void> =>
          (el) =>
            render(<ImportTableApp />, el),
      ),
  });

  island({
    id: "mount-library-table",
    // `Array.isArray`, not just "did it parse": `data-books="null"` parses happily and then throws inside `[...books].sort()` at render time.
    props: jsonAttr<LibraryBook[]>("books", [], Array.isArray),
    load: () =>
      import("./components/LibraryTable").then(
        ({ LibraryTable }): Mount<LibraryBook[]> =>
          (el, books) =>
            render(<LibraryTable initialBooks={books} />, el),
      ),
  });

  island({
    id: "mount-library-manager",
    load: () =>
      import("./components/LibraryManager").then(
        ({ LibraryManager }): Mount<void> =>
          (el) =>
            render(<LibraryManager />, el),
      ),
  });
});
