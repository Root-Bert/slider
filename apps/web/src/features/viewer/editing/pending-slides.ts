import { useSyncExternalStore } from 'react';
import type { EditSlide, Slide } from '@slider/shared';
import { isStandInSlide, STAND_IN_SLIDE } from '@/lib/api';

/**
 * Slides just put in from „Folie einfügen“, until the server's slide is there: shown at once
 * in the deck with the picture of the tile picked – no waiting on LibreOffice drawing it.
 */
export interface PendingSlide {
  deckId: string;
  /** The page id the edit gives the new slide – how its slide is found in the answer. */
  newPageId: string;
  /** It goes right after this slide. */
  afterSlideId: string;
  imageUrl: string;
  thumbnailUrl: string;
  aspectRatio: number;
}

let pending: readonly PendingSlide[] = [];
const listeners = new Set<() => void>();

const publish = (next: readonly PendingSlide[]) => {
  pending = next;
  for (const listener of listeners) listener();
};

/** Forgets the stand-in once the server's slide is shown. */
export const dropPendingSlide = (newPageId: string) => {
  if (pending.some((slide) => slide.newPageId === newPageId))
    publish(pending.filter((slide) => slide.newPageId !== newPageId));
};

/** Shows `slide` while its edit is on its way; a refused edit takes it out again. */
export function showPendingSlide(slide: PendingSlide, done: Promise<boolean>): void {
  publish([...pending, slide]);
  void done.then(
    (ok) => !ok && dropPendingSlide(slide.newPageId),
    () => dropPendingSlide(slide.newPageId),
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const usePendingSlides = (): readonly PendingSlide[] =>
  useSyncExternalStore(subscribe, () => pending);

/** The id a slide just put in has until the server's slide is there. */
export const pendingSlideId = (newPageId: string) => `${STAND_IN_SLIDE}${newPageId}`;

export const isPendingSlideId = isStandInSlide;

/**
 * `slides` with the deck's slides just put in, each after its slide – until the server's slide
 * (by its page id in the edit state) is in `slides`; then that one is shown, and the stand-in is
 * named in `settled` to be forgotten.
 */
export function withPendingSlides(
  deckId: string,
  slides: readonly Slide[],
  editSlides: readonly EditSlide[] | undefined,
  shown: readonly PendingSlide[],
): { slides: readonly Slide[]; settled: string[] } {
  const own = shown.filter((slide) => slide.deckId === deckId);
  const settled: string[] = [];
  if (own.length === 0) return { slides, settled };
  const ids = new Set(slides.map((slide) => slide.id));
  const out = [...slides];
  for (const stand of own) {
    const real = editSlides?.find((slide) => slide.pageId === stand.newPageId)?.slideId;
    if (real && ids.has(real)) {
      settled.push(stand.newPageId);
      continue;
    }
    const at = out.findIndex((slide) => slide.id === stand.afterSlideId);
    const before = out[at];
    if (!before) continue;
    out.splice(at + 1, 0, {
      id: pendingSlideId(stand.newPageId),
      deckId,
      position: before.position + 1,
      title: null,
      hidden: false,
      aspectRatio: stand.aspectRatio,
      imageUrl: stand.imageUrl,
      thumbnailUrl: stand.thumbnailUrl,
      shapes: [],
      guides: before.guides,
      openCommentCount: 0,
      change: null,
      variantOf: null,
      transition: 'none',
    });
  }
  return { slides: out, settled };
}
