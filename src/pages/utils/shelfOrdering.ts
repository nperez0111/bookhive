/** Stringified by Script: all state and helpers must live inside this function. */
export function shelfOrdering(document: Document) {
  const root = document.querySelector<HTMLElement>("[data-shelf-ordering]");
  const grid = root?.querySelector<HTMLElement>("[data-order-grid]");
  const toolbar = root?.querySelector<HTMLElement>("[data-order-toolbar]");
  const start = toolbar?.querySelector<HTMLButtonElement>("[data-order-start]");
  const save = toolbar?.querySelector<HTMLButtonElement>("[data-order-save]");
  const cancel = toolbar?.querySelector<HTMLButtonElement>("[data-order-cancel]");
  const status = toolbar?.querySelector<HTMLElement>("[data-order-status]");
  if (
    !root ||
    !grid ||
    !toolbar ||
    !start ||
    !save ||
    !cancel ||
    !status ||
    root.dataset["orderBound"]
  )
    return;
  root.dataset["orderBound"] = "true";
  toolbar.hidden = false;
  let editing = false;
  let saving = false;
  const rows = () => Array.from(grid.querySelectorAll<HTMLElement>("[data-order-item]"));
  let confirmed = rows();
  const refresh = () => {
    const current = rows();
    start.hidden = editing;
    save.hidden = !editing;
    cancel.hidden = !editing;
    save.disabled = saving || current.every((row, index) => row === confirmed[index]);
    cancel.disabled = saving;
    save.textContent = saving ? "Saving…" : "Save order";
    grid.setAttribute("aria-busy", String(saving));
    current.forEach((row, index) => {
      const rank = row.querySelector<HTMLElement>("[data-order-rank]");
      if (rank) rank.textContent = String(index + 1);
      const controls = row.querySelector<HTMLElement>("[data-order-controls]");
      if (controls) controls.hidden = !editing;
      const remove = row.querySelector<HTMLElement>("[data-order-remove]");
      if (remove) remove.hidden = editing;
      row.querySelectorAll<HTMLButtonElement>("[data-order-move]").forEach((button) => {
        button.disabled =
          saving ||
          (button.dataset["orderMove"] === "-1" ? index === 0 : index === current.length - 1);
      });
    });
  };
  start.addEventListener("click", () => {
    confirmed = rows();
    editing = true;
    status.textContent = "Use the arrows to move books earlier or later, then save your order.";
    refresh();
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    confirmed.forEach((row) => grid.append(row));
    editing = false;
    status.textContent = "Changes cancelled.";
    refresh();
    start.focus();
  });
  grid.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-order-move]")
        : null;
    if (!button || !editing || saving || button.disabled) return;
    const row = button.closest<HTMLElement>("[data-order-item]");
    if (!row) return;
    const current = rows();
    const index = current.indexOf(row);
    const delta = Number(button.dataset["orderMove"]);
    const neighbor = current[index + delta];
    if (!neighbor) return;
    if (delta < 0) grid.insertBefore(row, neighbor);
    else grid.insertBefore(neighbor, row);
    refresh();
    status.textContent = `${row.dataset["orderTitle"]} moved to position ${index + delta + 1}. Not saved yet.`;
    // Reparenting can drop focus; at a boundary focus the opposite, enabled arrow.
    const focus = button.disabled
      ? row.querySelector<HTMLButtonElement>("[data-order-move]:not(:disabled)")
      : button;
    focus?.focus();
  });
  save.addEventListener("click", async () => {
    if (saving || save.disabled) return;
    saving = true;
    status.textContent = "Saving order…";
    refresh();
    try {
      const response = await fetch(root.dataset["reorderUrl"]!, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ itemUris: rows().map((row) => row.dataset["orderItem"]) }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true)
        throw new Error(result.message || "Could not save the order. Please try again.");
      confirmed = rows();
      editing = false;
      status.textContent = "Order saved.";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not save the order. Please try again.";
    } finally {
      saving = false;
      refresh();
      if (!editing) start.focus();
    }
  });
  refresh();
}
