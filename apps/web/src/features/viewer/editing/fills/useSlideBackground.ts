import { nativeFill, type FillLayer } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useUploadEditImage } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { backgroundPreviews } from './background-previews';
import { bakeFills } from './bake-fills';

/** A picture of the layers waits this long (ms) for the next change before it is drawn. */
const BAKE_DELAY = 350;

/**
 * Sets slides' backgrounds to fill layers: one colour or gradient as such, anything else drawn
 * as one picture of the slide first (after a short pause, so dragging a slider draws once) and
 * uploaded – once for every slide it goes on.
 */
function useSetSlideBackground() {
  const editing = useEditing();
  const { deck } = useViewerData();
  const upload = useUploadEditImage(deck.id);
  const toast = useViewerToast();
  const ticket = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // A picture still waiting is drawn at once when the panel goes, not dropped.
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

  return (pageIds: readonly string[], fills: FillLayer[], coalesce?: string): Promise<void> => {
    window.clearTimeout(timer.current);
    // One waiting before is superseded: its promise settles, nothing of it is drawn.
    waiting.current?.drop();
    waiting.current = null;
    const mine = ++ticket.current;
    const key = coalesce && `background:${coalesce}:${pageIds.join(',')}`;
    if (nativeFill(fills, true) !== 'composite') {
      return editing
        .apply(
          pageIds.map((pageId) => ({ type: 'setSlideBackground', pageId, fills })),
          { coalesce: key },
        )
        .then(() => undefined);
    }
    return new Promise((resolve) => {
      const run = () => {
        waiting.current = null;
        void (async () => {
          try {
            if (mine !== ticket.current) return;
            const file = await bakeFills(fills, editing.pageSize, deck.id);
            if (mine !== ticket.current) return;
            const image = await upload.mutateAsync(file);
            if (mine !== ticket.current) return;
            await editing.apply(
              pageIds.map((pageId) => ({
                type: 'setSlideBackground',
                pageId,
                fills,
                composite: { imageId: image.imageId },
              })),
              { coalesce: key },
            );
          } catch (error) {
            if (mine === ticket.current)
              toast(
                error instanceof Error ? error.message : 'Der Hintergrund ließ sich nicht setzen.',
                'danger',
              );
          } finally {
            resolve();
          }
        })();
      };
      waiting.current = { run, drop: resolve };
      timer.current = window.setTimeout(run, BAKE_DELAY);
    });
  };
}

/**
 * A slide's background layers as shown while they are changed: what was set last until the
 * slide has it (the picture of several takes a moment), then the slide's. `change` sets them on
 * this slide – or on `pageIds`, every slide named.
 */
export function useBackgroundDraft(own: FillLayer[], pageId: string) {
  const set = useSetSlideBackground();
  const editing = useEditing();
  const slideId = editing.state?.slides.find((slide) => slide.pageId === pageId)?.slideId;
  const [draft, setDraft] = useState<FillLayer[] | null>(null);
  const pending = useRef(0);
  const change = (fills: FillLayer[], coalesce?: string, pageIds: readonly string[] = [pageId]) => {
    setDraft(fills);
    const mine = ++pending.current;
    // Drawn on this slide at once (`SlideCompositor`) – the master's again too (its background
    // drawn alone ahead, `masterGround`).
    const shown = slideId && pageIds.includes(pageId);
    const preview = shown ? backgroundPreviews.show(slideId, fills, own) : undefined;
    if (!shown && slideId) backgroundPreviews.clear(slideId);
    void set(pageIds, fills, coalesce).finally(() => {
      if (mine !== pending.current) return;
      setDraft(null);
      if (slideId && preview !== undefined) backgroundPreviews.settle(slideId, preview);
    });
  };
  return { fills: draft ?? own, change };
}
