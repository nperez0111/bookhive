import { render } from "hono/jsx/dom";

import { BookActionRow } from "./BookActionRow";
import { BookActivityPanel, BookUserTimestamp } from "./BookActivityPanel";
import { createUserBookStore, type BookActionsProps } from "./userBookStore";

/**
 * Three mounts, one store. The status/owned buttons sit in the hero card and
 * the activity form two cards down, so they cannot share a root; the server
 * markup inside each mount is the pre-hydration paint and is replaced here.
 */
export function mountBookIslands(props: BookActionsProps) {
  const store = createUserBookStore(props);
  const actions = document.getElementById("mount-book-actions");
  const timestamp = document.getElementById("mount-book-timestamp");
  const activity = document.getElementById("mount-book-activity");
  if (actions) render(<BookActionRow store={store} />, actions);
  if (timestamp) render(<BookUserTimestamp store={store} />, timestamp);
  if (activity) render(<BookActivityPanel store={store} props={props} />, activity);
}
