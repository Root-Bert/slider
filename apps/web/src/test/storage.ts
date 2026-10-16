import { vi, type Mock } from 'vitest';

/**
 * Test doubles for per-browser storage in the node test project (no DOM, no `localStorage`).
 * Stubs `localStorage` (or `sessionStorage`) on the global object and on a stub `window`, so
 * modules see the same storage whichever global they use. Call `vi.unstubAllGlobals()` in
 * `afterEach`. Assert on the returned Map – a module that silently falls back to its default
 * would otherwise pass for the wrong reason.
 */

export interface StorageStub {
  /** What is stored, by key. */
  values: Map<string, string>;
  getItem: Mock<(key: string) => string | null>;
  setItem: Mock<(key: string, value: string) => void>;
  removeItem: Mock<(key: string) => void>;
  /** Stub `window` listeners (`storage`, `pagehide` …), by event type. */
  listeners: Map<string, Set<(event: unknown) => void>>;
  /** Fires a `storage` event from another tab at the stub window. */
  dispatchStorage: (key: string | null) => void;
}

type Area = 'localStorage' | 'sessionStorage';

const windowListeners = new Map<string, Set<(event: unknown) => void>>();

/** A stub `window` with the given storages and add/removeEventListener. */
function stubWindow(storages: Partial<Record<Area, Storage>>) {
  const current = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  const base =
    current && typeof current === 'object' && '__storageStub' in current
      ? current
      : {
          __storageStub: true,
          addEventListener: (type: string, listener: (event: unknown) => void) => {
            if (!windowListeners.has(type)) windowListeners.set(type, new Set());
            windowListeners.get(type)!.add(listener);
          },
          removeEventListener: (type: string, listener: (event: unknown) => void) =>
            windowListeners.get(type)?.delete(listener),
        };
  vi.stubGlobal('window', Object.assign(base, storages));
}

/** In-memory storage seeded with `initial`; `area` picks local (default) or session storage. */
export function stubStorage(
  initial: Record<string, string> = {},
  area: Area = 'localStorage',
): StorageStub {
  windowListeners.clear();
  const values = new Map(Object.entries(initial));
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => void values.set(key, String(value)));
  const removeItem = vi.fn((key: string) => void values.delete(key));
  const storage = {
    getItem,
    setItem,
    removeItem,
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as unknown as Storage;
  vi.stubGlobal(area, storage);
  stubWindow({ [area]: storage });
  return {
    values,
    getItem,
    setItem,
    removeItem,
    listeners: windowListeners,
    dispatchStorage: (key) => {
      for (const listener of windowListeners.get('storage') ?? []) listener({ key });
    },
  };
}

/** Storage that throws on every access (private mode, blocked site data). */
export function stubBrokenStorage(area: Area = 'localStorage') {
  windowListeners.clear();
  const denied = () => {
    throw new Error('denied');
  };
  const storage = { getItem: denied, setItem: denied, removeItem: denied } as unknown as Storage;
  vi.stubGlobal(area, storage);
  stubWindow({ [area]: storage });
}
