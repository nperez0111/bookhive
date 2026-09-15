/** Runs inline in <head>, before pagereveal can snapshot a newly loaded document. */
export function installViewTransitions(document: Document): void {
  const window = document.defaultView!;
  const omitted = new Set<HTMLElement>();
  const prepare = () => {
    for (const element of omitted) element.style.removeProperty("view-transition-name");
    omitted.clear();
    const names = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>(
      ".book-cover, .book-title, .genre-name",
    )) {
      if (!element.getClientRects().length) continue;
      const name = window.getComputedStyle(element).viewTransitionName;
      if (!name || name === "none") continue;
      if (names.has(name)) {
        element.style.viewTransitionName = "none";
        omitted.add(element);
      } else {
        names.add(name);
      }
    }
  };
  // Recompute for both snapshots: hydration, filters and BFCache can change which
  // occurrence is rendered. Only the first rendered occurrence owns each name.
  window.addEventListener("pageswap", prepare);
  window.addEventListener("pagereveal", prepare);
}
