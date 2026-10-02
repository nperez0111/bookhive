import { Hono } from "hono";
import { expect, test } from "bun:test";
import { LibraryImport } from "./import";

test("CSV input label contains instructions, with import code outside its accessible name", async () => {
  const app = new Hono();
  app.get("/", (c) => c.html(<LibraryImport />));
  const html = await (await app.request("/")).text();
  const label = html.match(/<label\b[^>]*id="import-controls"[\s\S]*?<\/label>/)?.[0];
  expect(label).toContain('id="import-file"');
  expect(label).toContain("Drop CSV here or click to choose");
  expect(label).not.toContain("<script");
  expect(label).not.toContain("dispatchImportEvent");
  expect(html).toContain("dispatchImportEvent");
  const services = [...html.matchAll(/<input\b[^>]*name="import-service"[^>]*>/g)].map(
    (match) => match[0],
  );
  expect(services).toHaveLength(3);
  const selected = services.filter((input) => /\schecked(?:[\s=>])/.test(input));
  expect(selected).toHaveLength(1);
  expect(selected[0]).toContain('value="goodreads"');
  expect(services.join("")).not.toContain("defaultChecked");
});

// Execute the rendered inline script so tests exercise the same handlers browsers receive.
async function importControlHarness() {
  class Element {
    listeners = new Map<string, (event: any) => unknown>();
    classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
    };
    dataset: Record<string, string> = {};
    textContent = "";
    value = "goodreads";
    files: File[] = [];
    clicks = 0;
    addEventListener(type: string, handler: (event: any) => unknown) {
      this.listeners.set(type, handler);
    }
    dispatchEvent(event: { type: string }) {
      return this.listeners.get(event.type)?.(event);
    }
    click() {
      this.clicks++;
    }
    contains(target: unknown) {
      return target === this;
    }
  }
  const elements = new Map<string, Element>();
  const getElement = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const requests: { endpoint: string; file: File }[] = [];
  const events: any[] = [];
  const app = new Hono();
  app.get("/", (c) => c.html(<LibraryImport />));
  const html = await (await app.request("/")).text();
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  // Execute only our own rendered script; no external source enters this harness.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function("document", "window", "localStorage", "fetch", "Node", script!)(
    {
      getElementById: getElement,
      querySelectorAll: () => [getElement("service")],
      querySelector: () => getElement("service"),
      addEventListener: (_type: string, handler: () => void) => handler(),
    },
    { dispatchEvent: (event: CustomEvent) => events.push(event.detail) },
    { removeItem: () => {} },
    async (endpoint: string, options: { body: FormData }) => {
      requests.push({ endpoint, file: options.body.get("export") as File });
      return new Response('data: {"event":"import-complete"}\n\n');
    },
    Element,
  );
  return { getElement, requests, events };
}

test("import control activates the picker once for Enter and Space and ignores other keys", async () => {
  const { getElement } = await importControlHarness();
  const controls = getElement("import-controls");
  let prevented = 0;
  for (const [key, repeat] of [
    ["Enter", false],
    [" ", false],
    ["Enter", true],
    ["Tab", false],
  ] as const) {
    controls.dispatchEvent({
      type: "keydown",
      key,
      repeat,
      preventDefault: () => prevented++,
    } as any);
  }
  expect(getElement("import-file").clicks).toBe(2);
  expect(prevented).toBe(3);
});

test("dropping a CSV prevents navigation and imports through the picker change handler", async () => {
  const { getElement, requests, events } = await importControlHarness();
  const controls = getElement("import-controls");
  const file = new File(["Title,Author\nDune,Frank Herbert"], "library.CSV", { type: "" });
  const dataTransfer = { files: [file], dropEffect: "none" };
  let prevented = 0;
  controls.dispatchEvent({
    type: "dragover",
    dataTransfer,
    preventDefault: () => prevented++,
  } as any);
  expect(controls.dataset["dragging"]).toBe("true");
  expect(dataTransfer.dropEffect).toBe("copy");
  controls.dispatchEvent({ type: "drop", dataTransfer, preventDefault: () => prevented++ } as any);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(prevented).toBe(2);
  expect(controls.dataset["dragging"]).toBeUndefined();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.endpoint).toBe("/import/goodreads");
  expect(await requests[0]!.file.text()).toBe(await file.text());
  expect(events.map((event) => event.event)).toEqual(["import-start", "import-complete"]);
});

test("picker and drop reject non-CSV and multiple files before starting an import", async () => {
  const { getElement, requests, events } = await importControlHarness();
  const input = getElement("import-file");
  input.files = [new File(["image"], "cover.png")];
  await input.dispatchEvent(new Event("change"));
  expect(getElement("import-file-error").textContent).toContain("Choose one CSV");
  getElement("import-controls").dispatchEvent({
    type: "drop",
    dataTransfer: { files: [new File([], "one.csv"), new File([], "two.csv")] },
    preventDefault: () => {},
  } as any);
  expect(getElement("import-file-error").textContent).toContain("Choose one CSV");
  expect(requests).toHaveLength(0);
  expect(events).toHaveLength(0);
  input.files = [new File(["Title,Author"], "export.csv")];
  await input.dispatchEvent(new Event("change"));
  expect(getElement("import-file-error").textContent).toBe("");
  expect(requests).toHaveLength(1);
});
