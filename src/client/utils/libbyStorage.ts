import type { BookAvailability, LibbyLibrary } from "./libbyApi";

const SCHEMA = 1;
const LIBRARIES_KEY = `bookhive:libby:v${SCHEMA}:libraries`;
const RESULTS_KEY = (libraryKey: string, hiveId: string) =>
  `bookhive:libby:v${SCHEMA}:result:${libraryKey}:${hiveId}`;
const RESULTS_TTL_MS = 60 * 60 * 1000;

type StoredResult = { v: BookAvailability; t: number };

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — non-fatal */
  }
}

export function getSelectedLibraries(): LibbyLibrary[] {
  return safeGet<LibbyLibrary[]>(LIBRARIES_KEY) ?? [];
}

export function setSelectedLibraries(libraries: LibbyLibrary[]) {
  safeSet(LIBRARIES_KEY, libraries);
}

export function addLibrary(library: LibbyLibrary) {
  const current = getSelectedLibraries();
  if (current.some((l) => l.id === library.id)) return;
  setSelectedLibraries([...current, library]);
}

export function removeLibrary(libraryId: number) {
  setSelectedLibraries(getSelectedLibraries().filter((l) => l.id !== libraryId));
}

export function getCachedAvailability(libraryKey: string, hiveId: string): BookAvailability | null {
  const stored = safeGet<StoredResult>(RESULTS_KEY(libraryKey, hiveId));
  if (!stored) return null;
  if (Date.now() - stored.t > RESULTS_TTL_MS) return null;
  return stored.v;
}

export function setCachedAvailability(
  libraryKey: string,
  hiveId: string,
  result: BookAvailability,
) {
  safeSet(RESULTS_KEY(libraryKey, hiveId), { v: result, t: Date.now() });
}

export function clearLibbyCache() {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("bookhive:libby:")) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}
