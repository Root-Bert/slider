import { nativeFill, type EditableElement, type FillLayer } from '@slider/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useUploadEditImage } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { bakeFills, rememberUpload } from './bake-fills';

/** A picture of the layers waits this long (ms) for the next change before it is drawn. */
const BAKE_DELAY = 350;

/**
 * The latest change to each element's layers, across every place that sets them (the fill tab,
 * the redraw after a resize): an older picture still being drawn never lands over a newer one.
 */
let lastTicket = 0;
const latestFor = new Map<string, number>();
/** Elements whose layers are being drawn or wait to be: no redraw of the old ones meanwhile. */
const drawing = new Set<string>();
const drawingListeners = new Set<() => void>();
const subscribeDrawing = (listener: () => void) => {
  drawingListeners.add(listener);
  return () => {
    drawingListeners.delete(listener);
  };
};
function setDrawing(owner: string, active: boolean) {
  if (drawing.has(owner) === active) return;
  if (active) drawing.add(owner);
  else drawing.delete(owner);
  for (const listener of drawingListeners) listener();
}

/** The element's size in cm and its proportions. */
function sizeOf(element: EditableElement, page: { width: number; height: number }) {
  const width = element.bbox.w * page.width;
  const height = element.bbox.h * page.height;
  return { width, height, aspect: height > 0 ? width / height : 1 };
}

/**
 * Sets an element's fill layers: one colour or gradient as such, anything else drawn as one
 * picture first (after a short pause, so dragging a slider draws once) and uploaded.
 */
export function useSetFills() {
  const editing = useEditing();
  const { deck } = useViewerData();
  const upload = useUploadEditImage(deck.id);
  const toast = useViewerToast();
  const timer = useRef<number | undefined>(undefined);
  // A picture still waiting is drawn at once when the controls go, not dropped.
  const waiting = useRef<{ run: () => void; drop: () => void } | null>(null);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const pending = waiting.current;
      waiting.current = null;
      pending?.run();
    },
    [],
  );

  return (element: EditableElement, fills: FillLayer[], coalesce?: string): Promise<void> => {
    window.clearTimeout(timer.current);
    // One waiting before is superseded: its promise settles, nothing of it is drawn.
    waiting.current?.drop();
    waiting.current = null;
    const ticket = ++lastTicket;
    const owner = JSON.stringify([deck.id, element.id]);
    latestFor.set(owner, ticket);
    const current = () => latestFor.get(owner) === ticket;
    const settled = () => {
      if (!current()) return;
      latestFor.delete(owner);
      setDrawing(owner, false);
    };
    const key = coalesce && `fills:${coalesce}:${element.id}`;
    if (nativeFill(fills) !== 'composite') {
      setDrawing(owner, false);
      return editing
        .apply([{ type: 'setShapeStyle', elementId: element.id, fills }], { coalesce: key })
        .then(() => undefined)
        .finally(settled);
    }
    return new Promise((resolve) => {
      const run = () => {
        waiting.current = null;
        void (async () => {
          try {
            if (!current()) return;
            const size = sizeOf(element, editing.pageSize);
            const file = await bakeFills(fills, size, deck.id);
            if (!current()) return;
            const image = await upload.mutateAsync(file);
            if (!current()) return;
            await editing.apply(
              [
                {
                  type: 'setShapeStyle',
                  elementId: element.id,
                  fills,
                  composite: { imageId: image.imageId, aspect: size.aspect },
                },
              ],
              { coalesce: key },
            );
          } catch (error) {
            if (current())
              toast(
                error instanceof Error ? error.message : 'Die Füllung ließ sich nicht setzen.',
                'danger',
              );
          } finally {
            settled();
            resolve();
          }
        })();
      };
      setDrawing(owner, true);
      waiting.current = {
        run,
        drop: () => {
          settled();
          resolve();
        },
      };
      timer.current = window.setTimeout(run, BAKE_DELAY);
    });
  };
}

/** Uploads a picture for a layer: its id, drawn from the file at hand until the deck has it. */
export function useUploadLayerPicture() {
  const { deck } = useViewerData();
  const upload = useUploadEditImage(deck.id);
  return {
    pending: upload.isPending,
    upload: async (file: File): Promise<string> => {
      const image = await upload.mutateAsync(file);
      rememberUpload(image.imageId, file);
      return image.imageId;
    },
  };
}

/**
 * The layers as shown while they are changed: what was set last until the element has it (the
 * picture of several takes a moment), then the element's.
 */
export function useFillDraft(element: EditableElement) {
  const set = useSetFills();
  const own = element.look?.fills ?? [];
  const [draft, setDraft] = useState<FillLayer[] | null>(null);
  const pending = useRef(0);
  const change = (fills: FillLayer[], coalesce?: string) => {
    setDraft(fills);
    const ticket = ++pending.current;
    void set(element, fills, coalesce).finally(() => {
      if (ticket === pending.current) setDraft(null);
    });
  };
  return { fills: draft ?? own, change };
}

/**
 * The picked element's layers drawn anew once its proportions changed (resized): its picture of
 * them would be stretched. Once per size – an undone redraw is not redone.
 */
export function useFillRefresh(element: EditableElement | null) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const owner = JSON.stringify([deck.id, element?.id]);
  const baking = useSyncExternalStore(
    subscribeDrawing,
    () => drawing.has(owner),
    () => false,
  );
  const tried = useRef(new Set<string>());
  const aspect = element?.look?.fillAspect ?? null;
  const size = element ? sizeOf(element, editing.pageSize) : null;
  const stale =
    !!element &&
    aspect !== null &&
    !!size &&
    Math.abs(Math.log(size.aspect / aspect)) > 0.015 &&
    !editing.busy;
  const key = element && size ? `${owner}:${size.aspect.toFixed(3)}` : '';
  const set = useSetFills();
  const latest = useRef({ set, element });
  useEffect(() => {
    latest.current = { set, element };
  });
  useEffect(() => {
    if (!stale || baking || tried.current.has(key)) return;
    const now = latest.current.element;
    // Once a manual bake finishes, recheck whether its captured size still fits.
    if (now?.look) {
      tried.current.add(key);
      void latest.current.set(now, now.look.fills);
    }
  }, [stale, key, baking, aspect]);
}
