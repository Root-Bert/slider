import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef } from 'react';
import { isStandInSlide, slideLayersQuery } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerState } from '../../state/viewer-state';
import { useEditing } from '../editing-context';
import { layerFrames } from '../live/layer-frames';

/** Slides this close to the active one get their pictures loaded too, not only drawn. */
const LOADED_AROUND = 1;
/** After an edit, the active slide is taken apart again once editing paused this long. */
const AFTER_EDIT_MS = 1500;

/** Loads pictures into the browser's cache; a failed one fails where it is shown. */
const preload = (urls: readonly string[]) =>
  Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.decoding = 'async';
          image.onload = image.onerror = () => resolve();
          image.src = url;
        }),
    ),
  );

/**
 * The slides taken apart ahead, for whoever can edit the deck – so „Ebenen“ opens at once and
 * scrolling sideways finds its neighbours drawn (BER-185). One slide after another, the active one
 * first and then outwards, asked for as background work (the server's drawing waits behind
 * anything someone waits for, and keeps every element's picture: drawn once per look). After an
 * edit only the active slide again, once editing pauses; the others show their last pictures
 * until they are looked at (`useSlideLayers`).
 */
export function useLayersAhead() {
  const editing = useEditing();
  const { deck, slides } = useViewerData();
  const { activeSlideId } = useViewerState();
  const queryClient = useQueryClient();
  const seq = editing.state?.seq;
  // The step each slide was last taken apart at.
  const done = useRef(new Map<string, number>());
  const lastSeq = useRef(seq);
  const captureState = useEffectEvent(() => editing.state);

  useEffect(() => {
    if (!editing.available || seq === undefined || slides.length === 0) return;
    const stateAtStart = captureState();
    const at = Math.max(
      0,
      slides.findIndex((slide) => slide.id === activeSlideId),
    );
    const order = slides
      .map((slide, index) => ({ id: slide.id, distance: Math.abs(index - at) }))
      .sort((a, b) => a.distance - b.distance);
    const edited = lastSeq.current !== seq;
    lastSeq.current = seq;
    let cancelled = false;
    const run = async () => {
      for (const { id, distance } of order) {
        if (cancelled) return;
        // Just put in, not the server's yet.
        if (isStandInSlide(id)) continue;
        // Taken apart before: shown with those pictures; only the active one is drawn anew.
        if (done.current.has(id) && (distance > 0 || done.current.get(id) === seq)) continue;
        const data = await queryClient
          .fetchQuery(slideLayersQuery(deck.id, id, seq, 'background'))
          .catch(() => null);
        // Prefetching can finish after an edit, before either rendering surface ever saw
        // these pictures. Keep the request's geometry even when this run was cancelled.
        layerFrames(data ?? undefined, stateAtStart, id);
        if (!data || cancelled) continue;
        done.current.set(id, seq);
        if (distance <= LOADED_AROUND) {
          await preload([
            data.background,
            ...data.layers.flatMap((layer) => (layer.url ? [layer.url] : [])),
          ]);
        }
      }
    };
    // Right after an edit more may follow: drawn once editing pauses.
    const timer = window.setTimeout(() => void run(), edited ? AFTER_EDIT_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editing.available, seq, slides, activeSlideId, deck.id, queryClient]);
}
