import { expect, test } from "bun:test";
import { Hono } from "hono";
import { installShareMenus, ShareMenu } from "./ShareMenu";

function fixture(writeText: (text: string) => Promise<void>) {
  const node = (attributes: Record<string, string> = {}) => {
    const classes = new Set(["invisible", "opacity-0"]);
    const listeners = new Map<string, (event: Event) => void | Promise<void>>();
    return {
      attributes,
      listeners,
      textContent: "Copy link",
      disabled: false,
      focused: false,
      getAttribute(name: string) {
        return attributes[name] ?? null;
      },
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
      addEventListener(this: void, name: string, listener: (event: Event) => void | Promise<void>) {
        listeners.set(name, listener);
      },
      focus() {
        this.focused = true;
      },
      classList: {
        contains(name: string) {
          return classes.has(name);
        },
        toggle(name: string, force: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    };
  };
  const trigger = node({ "aria-expanded": "false" });
  const panel = node();
  const feedback = node();
  const label = node({ "data-copy-label": "Copy link" });
  const copy = { ...node({ "data-copy-url": "/books/test" }), querySelector: () => label };
  const nodes = {
    "[data-share-trigger]": trigger,
    "[data-share-panel]": panel,
    "[data-share-feedback]": feedback,
  };
  const root = {
    ...node(),
    querySelector: (selector: keyof typeof nodes) => nodes[selector],
    querySelectorAll: () => [copy],
    contains: () => true,
  };
  const document = {
    defaultView: {
      navigator: { clipboard: { writeText } },
      location: { origin: "https://bookhive.buzz" },
      clearTimeout: () => {},
      setTimeout: () => 1,
    },
    querySelectorAll: () => (root.attributes["data-share-bound"] === undefined ? [root] : []),
    addEventListener: root.addEventListener,
  };
  installShareMenus(document as unknown as Document);
  return { trigger, panel, feedback, copy, label, root };
}

test("copy waits for clipboard success before announcing success", async () => {
  let resolve!: () => void;
  let copied = "";
  const f = fixture((text) => {
    copied = text;
    return new Promise<void>((done) => {
      resolve = done;
    });
  });
  const pending = f.copy.listeners.get("click")!(new Event("click"));
  expect(f.label.textContent).toBe("Copying…");
  expect(f.copy.disabled).toBe(true);
  await f.trigger.listeners.get("click")!(new Event("click"));
  const escape = new Event("keydown", { cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await f.root.listeners.get("keydown")!(escape);
  expect(f.trigger.getAttribute("aria-expanded")).toBe("false");
  expect(f.trigger.focused).toBe(true);
  resolve();
  await pending;
  expect(copied).toBe("https://bookhive.buzz/books/test");
  expect(f.label.textContent).toBe("Copied!");
  expect(f.feedback.textContent).toBe("Link copied.");
  expect(f.copy.disabled).toBe(false);
});

test("rejected clipboard access is handled and announced without false success", async () => {
  const f = fixture(() => Promise.reject(new DOMException("Denied", "NotAllowedError")));
  await f.copy.listeners.get("click")!(new Event("click"));
  expect(f.label.textContent).toBe("Copy failed");
  expect(f.feedback.textContent).toBe("Could not copy. Please try again.");
  expect(f.copy.disabled).toBe(false);
});

test("Escape closes an expanded share panel and returns focus to its trigger", async () => {
  const f = fixture(() => Promise.resolve());
  await f.trigger.listeners.get("click")!(new Event("click"));
  expect(f.trigger.getAttribute("aria-expanded")).toBe("true");
  const escape = new Event("keydown", { cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await f.root.listeners.get("keydown")!(escape);
  expect(f.trigger.getAttribute("aria-expanded")).toBe("false");
  expect(f.panel.classList.contains("invisible")).toBe(true);
  expect(f.trigger.focused).toBe(true);
  expect(escape.defaultPrevented).toBe(true);
});

test("share feedback has a live status region in server-rendered markup", async () => {
  const app = new Hono();
  app.get("/", (c) =>
    c.html(<ShareMenu blueskyHref="https://bsky.app/" copyPath="/book" rssPath="/rss" />),
  );
  const html = await (await app.request("/")).text();
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
});
