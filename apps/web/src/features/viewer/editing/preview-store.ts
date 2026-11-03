import { createContext, use, useSyncExternalStore } from 'react';
import type { ElementPreview } from './editing-context';

/*
 * The element being dragged, resized or turned, where it is now (`Editing.setPreview`). It
 * changes with every pointer move of a drag (rendered synchronously, `useRectEdit`): kept in a
 * store of its own rather than a context, so a move renders only the readers whose slice of it
 * changed – the dragged element's – not every reader on every slide.
 */

export interface PreviewStore {
  get: () => ElementPreview | null;
  set: (preview: ElementPreview | null, ownerId?: string, surface?: object) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPreviewStore(): PreviewStore {
  let current: ElementPreview | null = null;
  let surface: object | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next, ownerId, fromSurface) => {
      // A frame unmounted by a mode switch, or an older commit settling later, only clears
      // its own element. It must not end the next element's gesture.
      if (next === null && ownerId && current?.elementId !== ownerId) return;
      if (next === null && fromSurface && surface !== fromSurface) return;
      if (next === current) return;
      surface = next ? fromSurface : undefined;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Outside an editable viewer (tests, previews): nothing is ever dragged. */
const NO_PREVIEWS = createPreviewStore();

export const PreviewStoreContext = createContext<PreviewStore>(NO_PREVIEWS);

/**
 * A slice of the preview: rendered again only when it changes (by `Object.is`) – `select` must
 * return the preview itself, a primitive, or `null`, never a new object.
 */
export function usePreviewSelector<T>(select: (preview: ElementPreview | null) => T): T {
  const store = use(PreviewStoreContext);
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(null),
  );
}

/** The preview while `elementId` is the element dragged, else `null`. */
export const usePreviewOf = (elementId: string | null | undefined): ElementPreview | null =>
  usePreviewSelector((preview) =>
    elementId != null && preview?.elementId === elementId ? preview : null,
  );

/** The preview while one of `elementIds` (a slide's elements) is the element dragged. */
export const usePreviewAmong = (
  elementIds: ReadonlySet<string> | readonly string[],
): ElementPreview | null =>
  usePreviewSelector((preview) => {
    if (!preview) return null;
    const among =
      elementIds instanceof Set
        ? elementIds.has(preview.elementId)
        : (elementIds as readonly string[]).includes(preview.elementId);
    return among ? preview : null;
  });
