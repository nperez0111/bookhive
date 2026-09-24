import { expect, test } from "bun:test";
import { installViewTransitions } from "./viewTransitions";
import { viewTransitionName } from "../../lib/viewTransitionName";
import { Layout } from "../layout";

test("genre transition names are stable, valid CSS identifiers and collision-free", () => {
  const values = [
    "Science Fiction",
    "Science-Fiction",
    "Science_Fiction",
    "科学",
    "A; color:red",
    "",
  ];
  const names = values.map((value) => viewTransitionName("genre", value));
  expect(new Set(names).size).toBe(values.length);
  for (const name of names) expect(name).toMatch(/^genre-[a-z0-9-]*$/);
  expect(viewTransitionName("genre", "Science Fiction")).toBe(names[0]!);
});

test("snapshots deduplicate book and genre names and reconsider filtered/BFCache occurrences", () => {
  const listeners = new Map<string, () => void>();
  const node = (name: string) => ({
    name,
    visible: true,
    style: {
      viewTransitionName: "",
      removeProperty() {
        this.viewTransitionName = "";
      },
    },
    getClientRects() {
      return this.visible ? [{}] : [];
    },
  });
  const nodes = [
    node("genre-fiction"),
    node("genre-fiction"),
    node("book-cover-1"),
    node("book-cover-1"),
  ];
  const document = {
    defaultView: {
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      getComputedStyle: (element: ReturnType<typeof node>) => ({
        viewTransitionName: element.style.viewTransitionName || element.name,
      }),
    },
    querySelectorAll: () => nodes,
  };
  installViewTransitions(document as unknown as Document);
  listeners.get("pagereveal")!();
  expect(nodes.map((element) => element.style.viewTransitionName)).toEqual([
    "",
    "none",
    "",
    "none",
  ]);
  nodes[0]!.visible = false;
  listeners.get("pageswap")!();
  expect(nodes[1]!.style.viewTransitionName).toBe("");
  nodes[0]!.visible = true;
  listeners.get("pagereveal")!();
  expect(nodes[1]!.style.viewTransitionName).toBe("none");
});

test("layout registers snapshot handling inline in head before the body renders", async () => {
  const rendered = await Layout({ url: "https://bookhive.buzz/explore", assetUrls: null });
  const html = String(rendered);
  expect(html.indexOf("@view-transition")).toBeGreaterThan(html.indexOf("<head>"));
  expect(html.indexOf("@view-transition")).toBeLessThan(html.indexOf('<script type="module"'));
  expect(html).toMatch(/@view-transition\s*\{\s*navigation:\s*auto;/);
  expect(html.indexOf('addEventListener("pagereveal"')).toBeGreaterThan(html.indexOf("<head>"));
  expect(html.indexOf('addEventListener("pagereveal"')).toBeLessThan(html.indexOf("</head>"));
});
