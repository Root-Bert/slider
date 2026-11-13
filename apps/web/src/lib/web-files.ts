import { API_PREFIX } from '@slider/shared';
import { savableAsFile } from './desktop-bridge';

/*
 * Files on this computer in the browser (BER-201) – Chromium's File System Access, where the
 * desktop app's bridge is not there (`desktop-bridge.ts`); the same items, one behaviour:
 * „Öffnen …“ picks files that become presentations, „Als Datei sichern …“ makes an ODP a file.
 * An ODP stays that file: while one of Slider's pages is open and the browser lets it write,
 * every step goes into it, and a change made to it elsewhere comes in as a new version. The
 * handles are kept in this browser, per deck, and forgotten when signing out (`forgetOffline`).
 */

type Permission = 'granted' | 'denied' | 'prompt';
interface WritableHandle extends FileSystemFileHandle {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<Permission>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<Permission>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface FilePickers {
  showOpenFilePicker(options: {
    multiple?: boolean;
    types?: PickerType[];
  }): Promise<WritableHandle[]>;
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: PickerType[];
  }): Promise<WritableHandle>;
}

const ODP: PickerType = {
  description: 'Präsentationen',
  accept: { 'application/vnd.oasis.opendocument.presentation': ['.odp', '.otp'] },
};
const ANY_DECK: PickerType = {
  description: 'Präsentationen',
  accept: {
    'application/vnd.oasis.opendocument.presentation': ['.odp', '.otp'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    'application/pdf': ['.pdf'],
  },
};

const pickers = () => window as unknown as Window & Partial<FilePickers>;

/** Whether this browser can keep a file on this computer (Chromium, a secure page). */
export const webFilesSupported = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof pickers().showOpenFilePicker === 'function' &&
  typeof pickers().showSaveFilePicker === 'function';

// ── The handles, per deck ──────────────────────────────────────────────────────────────────

const DB = 'slider-web-files';
const STORE = 'files';

interface Kept {
  deckId: string;
  handle: WritableHandle;
  /** The file's `lastModified` after Slider last wrote or read it: newer means changed elsewhere. */
  seen: number;
}

function database(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'deckId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function inStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await database();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  }).finally(() => db.close()) as Promise<T | undefined>;
}

const keptFile = (deckId: string) =>
  inStore<Kept | undefined>(
    'readonly',
    (store) => store.get(deckId) as IDBRequest<Kept | undefined>,
  );
const keep = (kept: Kept) => inStore('readwrite', (store) => store.put(kept));

/** Signing out: the files stay on this computer, the decks no longer know them. */
export async function forgetWebFiles(): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ── What the items do ──────────────────────────────────────────────────────────────────────

const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** „Öffnen …“: the picked files, each with its handle; nothing when the dialog is closed. */
export async function pickPresentations(): Promise<{ file: File; handle: WritableHandle }[]> {
  try {
    const handles = await pickers().showOpenFilePicker!({ multiple: true, types: [ANY_DECK] });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch (error) {
    if (aborted(error)) return [];
    throw error;
  }
}

/** A picked file became `deckId`: an ODP stays that file. */
export async function keepPickedFile(deckId: string, handle: WritableHandle, file: File) {
  if (savableAsFile(file.name)) await keep({ deckId, handle, seen: file.lastModified });
}

async function deckFile(deckId: string): Promise<Blob> {
  const response = await fetch(`${API_PREFIX}/decks/${encodeURIComponent(deckId)}/file`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Die Präsentation konnte nicht gelesen werden.');
  return response.blob();
}

/** Decks being written into their file now: their own write is no change made elsewhere. */
const writing = new Set<string>();

async function writeInto(deckId: string, handle: WritableHandle): Promise<void> {
  const bytes = await deckFile(deckId);
  writing.add(deckId);
  try {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    await keep({ deckId, handle, seen: (await handle.getFile()).lastModified });
  } finally {
    writing.delete(deckId);
  }
}

/** „Als Datei sichern …“: the save dialog; `false` when it is closed. */
export async function saveDeckAsFile(deckId: string, title: string): Promise<boolean> {
  let handle: WritableHandle;
  try {
    handle = await pickers().showSaveFilePicker!({ suggestedName: `${title}.odp`, types: [ODP] });
  } catch (error) {
    if (aborted(error)) return false;
    throw error;
  }
  await writeInto(deckId, handle);
  return true;
}

/**
 * The deck's file, if it is one here and the browser lets Slider at it now (`ask`: on a click or
 * key press, the browser may ask once – after a reload it forgets until then).
 */
async function allowedFile(deckId: string, mode: 'read' | 'readwrite', ask = false) {
  const kept = await keptFile(deckId);
  if (!kept) return null;
  let permission = await kept.handle.queryPermission({ mode });
  if (permission === 'prompt' && ask) permission = await kept.handle.requestPermission({ mode });
  return permission === 'granted' ? kept : null;
}

/** On a click: the browser asked whether Slider may write the deck's file. */
export const askForFile = (deckId: string) => allowedFile(deckId, 'readwrite', true);

/** The deck as it is now into its file, if it is one here and may be written. */
export async function writeDeckFile(deckId: string): Promise<void> {
  const kept = await allowedFile(deckId, 'readwrite');
  if (!kept) return;
  // Changed elsewhere and not taken in yet: that change comes in first (`fileChangedElsewhere`).
  if ((await kept.handle.getFile()).lastModified > kept.seen) return;
  await writeInto(deckId, kept.handle);
}

/**
 * The deck's file, if it was changed elsewhere since Slider last wrote or read it – marked as seen.
 */
export async function fileChangedElsewhere(deckId: string): Promise<File | null> {
  if (writing.has(deckId)) return null;
  const kept = await allowedFile(deckId, 'read');
  if (!kept || writing.has(deckId)) return null;
  const file = await kept.handle.getFile();
  if (file.lastModified <= kept.seen) return null;
  await keep({ ...kept, seen: file.lastModified });
  return file;
}
