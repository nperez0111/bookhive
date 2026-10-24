import { createImportProgressParser, MAX_CSV_BYTES, type ImportProgress } from "../importProgress";

const complete = {
  event: "import-complete",
  stage: "complete",
  stageProgress: { current: 2, total: 3, message: "Imported two books" },
  failedBooks: [{ title: "Missing book", author: "An Author" }],
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

test("parses buffered SSE with keepalives and partial failures", () => {
  const updates: ImportProgress[] = [];
  const parser = createImportProgressParser((event) => updates.push(event));
  parser.push(
    `event: keepalive\ndata: \n\n${frame({ event: "import-error", stage: "uploading", error: "One failed" })}${frame(complete)}`,
  );
  expect(parser.finish()).toMatchObject({
    current: 2,
    total: 3,
    failedBooks: complete.failedBooks,
  });
  expect(updates).toHaveLength(2);
});

test("parses every split of CRLF frames, including split CRLF boundaries", () => {
  const text = `\uFEFF: comment\r\n\r\n${frame(complete).replace(/\n/g, "\r\n")}`;
  for (let split = 0; split < text.length; split++) {
    const parser = createImportProgressParser(() => {});
    parser.push(text.slice(0, split));
    parser.push(text.slice(split));
    expect(parser.finish().event).toBe("import-complete");
  }
});

test("supports multiline data and a final frame without a blank line", () => {
  const parser = createImportProgressParser(() => {});
  parser.push(
    'data: {"event":"import-complete",\ndata: "stage":"complete","stageProgress":{"message":"Done"}}',
  );
  expect(parser.finish().message).toBe("Done");
});

test("does not report success for truncated streams or fatal server errors", () => {
  const parser = createImportProgressParser(() => {});
  parser.push(frame({ event: "book-load", stage: "loading" }));
  expect(() => parser.finish()).toThrow("ended before completion");
  const failed = createImportProgressParser(() => {});
  failed.push(frame({ event: "import-error", stage: "error", error: "Invalid CSV headers" }));
  expect(() => failed.finish()).toThrow("Invalid CSV headers");
});

test("rejects malformed event JSON and preserves the 50MB upload bound", () => {
  expect(() => createImportProgressParser(() => {}).push("data: not json\n\n")).toThrow(
    "invalid progress",
  );
  expect(MAX_CSV_BYTES).toBe(52_428_800);
});
