export type ImportService = "goodreads" | "storygraph";

export type ImportStage =
  | "initializing"
  | "searching"
  | "uploading"
  | "complete";

export type ImportBookSuccess = {
  hiveId: string;
  title: string;
  authors: string;
  coverImage?: string;
  status?: string;
  finishedAt?: string;
  stars?: number;
  review?: string;
  alreadyExists?: boolean;
};

export type ImportBookFailure = {
  title: string;
  author: string;
  // optional source fields for better matching
  isbn10?: string;
  isbn13?: string;
  status?: string;
  finishedAt?: string;
  stars?: number;
  review?: string;
};

export type ImportEventBase = {
  event:
    | "import-start"
    | "upload-start"
    | "book-load"
    | "book-upload"
    | "book-failed"
    | "import-complete";
  stage?: ImportStage;
  stageProgress?: {
    current?: number | string;
    total?: number | string;
    message?: string;
  };
  id?: number;
};

export type BookLoadEvent = ImportEventBase & {
  event: "book-load";
  title: string;
  author: string;
};

export type BookFailedEvent = ImportEventBase & {
  event: "book-failed";
  failedBook: ImportBookFailure;
};

export type BookUploadEvent = ImportEventBase & {
  event: "book-upload";
  processed: number;
  total: number;
  uploaded: number;
  book: ImportBookSuccess;
};

export type ImportStartEvent = ImportEventBase & { event: "import-start" };
export type UploadStartEvent = ImportEventBase & {
  event: "upload-start";
  stageProgress: { current: number; total: number; message: string };
};
export type ImportCompleteEvent = ImportEventBase & {
  event: "import-complete";
  stageProgress: { current: number; total: number; message: string };
  failedBooks?: ImportBookFailure[];
};

export type ImportEvent =
  | ImportStartEvent
  | UploadStartEvent
  | BookLoadEvent
  | BookUploadEvent
  | BookFailedEvent
  | ImportCompleteEvent;

export type ImportRow =
  | ({ success: true } & ImportBookSuccess)
  | ({ success: false } & ImportBookFailure);
