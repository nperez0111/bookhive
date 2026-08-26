/// Wire types for the single-shot EPUB conversion Worker.

export type ConvertRequest = {
  id: string;
  /** Path to the stored original. Only a path crosses the boundary. */
  sourcePath: string;
  /** Where the worker writes the EPUB, so the bytes never come back over the wire. */
  destPath: string;
};

export type ConvertResponse =
  | { id: string; ok: true; sizeBytes: number }
  | { id: string; ok: false; error: string };
