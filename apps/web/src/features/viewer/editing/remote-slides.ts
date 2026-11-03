import { useSyncExternalStore } from 'react';
import type { EditSlide, LiveStep, Slide, SlideOperation } from '@slider/shared';
import { pendingSlideId } from './pending-slides';

/*
 * Someone else's slide operations (a slide duplicated, moved, deleted, hidden), shown at once in the
 * deck – not only after the slides and the edit state are fetched anew. Each is applied to the
 * slides shown; it is let go of once the edit state is at its step and applying it changes nothing
 * any more (the fetched slides have it). A new copy shows its source's picture until its own is
 * there. Not here: a slide from a layout or template (`addSlide`, no picture of it yet) and
 * variants – those wait for the refetch.
 */

type SlideOp = Extract<
  SlideOperation,
  { type: 'deleteSlide' | 'moveSlide' | 'duplicateSlide' | 'setSlideHidden' }
>;

export interface RemoteSlideOp {
  deckId: string;
  seq: number;
  operation: SlideOp;
}

const isSlideOp = (operation: SlideOperation): operation is SlideOp =>
  operation.type === 'deleteSlide' ||
  operation.type === 'moveSlide' ||
  operation.type === 'duplicateSlide' ||
  operation.type === 'setSlideHidden';

let shown: readonly RemoteSlideOp[] = [];
const listeners = new Set<() => void>();

const publish = (next: readonly RemoteSlideOp[]) => {
  shown = next;
  for (const listener of listeners) listener();
};

/** Someone else's `step` in deck `deckId`: its slide operations shown at once. */
export function showRemoteSlideStep(deckId: string, step: LiveStep): void {
  const added = step.operations
    .filter(isSlideOp)
    .map((operation) => ({ deckId, seq: step.seq, operation }));
  if (added.length > 0) publish([...shown, ...added]);
}

/** Forgets what `settled` names (shown by the fetched slides now). */
export function dropRemoteSlideOps(settled: readonly RemoteSlideOp[]): void {
  if (settled.length === 0) return;
  const gone = new Set(settled);
  publish(shown.filter((entry) => !gone.has(entry)));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useRemoteSlideOps = (): readonly RemoteSlideOp[] =>
  useSyncExternalStore(subscribe, () => shown);

/** `slides` with operation `op` applied (the same array when it changes nothing). */
function applied(
  slides: readonly Slide[],
  op: SlideOp,
  idOf: (pageId: string) => string,
): readonly Slide[] {
  const at = slides.findIndex((slide) => slide.id === idOf(op.pageId));
  if (op.type === 'deleteSlide') return at < 0 ? slides : slides.filter((_, i) => i !== at);
  if (op.type === 'setSlideHidden') {
    const slide = slides[at];
    if (!slide || slide.hidden === op.hidden) return slides;
    return slides.map((item, i) => (i === at ? { ...item, hidden: op.hidden } : item));
  }
  // After `after` (`null`: first) – where it is already, nothing changes.
  const place = (list: readonly Slide[], slide: Slide): readonly Slide[] => {
    const rest = list.filter((item) => item.id !== slide.id);
    const after = op.after === null ? -1 : rest.findIndex((item) => item.id === idOf(op.after!));
    if (op.after !== null && after < 0) return list;
    const out = [...rest.slice(0, after + 1), slide, ...rest.slice(after + 1)];
    return out.every((item, i) => item.id === list[i]?.id) ? list : out;
  };
  if (op.type === 'moveSlide') {
    const slide = slides[at];
    return slide ? place(slides, slide) : slides;
  }
  // A copy: there already (the fetched one, by its page id), or its source's picture meanwhile.
  if (slides.some((slide) => slide.id === idOf(op.newPageId))) return slides;
  const source = slides[at];
  if (!source) return slides;
  return place(slides, { ...source, id: pendingSlideId(op.newPageId), title: source.title });
}

/**
 * `slides` with the deck's remote slide operations applied in order; `settled`: those the edit
 * state (at `seq`) and the fetched slides already show.
 */
export function withRemoteSlides(
  deckId: string,
  slides: readonly Slide[],
  editSlides: readonly EditSlide[] | undefined,
  seq: number | undefined,
  ops: readonly RemoteSlideOp[],
): { slides: readonly Slide[]; settled: RemoteSlideOp[] } {
  const own = ops.filter((entry) => entry.deckId === deckId);
  if (own.length === 0) return { slides, settled: [] };
  const byPage = new Map(editSlides?.map((slide) => [slide.pageId, slide.slideId]));
  // A slide the edit state does not know yet (a copy just made): its stand-in.
  const idOf = (pageId: string) => byPage.get(pageId) ?? pendingSlideId(pageId);
  let out = slides;
  const settled: RemoteSlideOp[] = [];
  for (const entry of own) {
    const next = applied(out, entry.operation, idOf);
    if (next === out && seq !== undefined && seq >= entry.seq) settled.push(entry);
    out = next;
  }
  return { slides: out, settled };
}
