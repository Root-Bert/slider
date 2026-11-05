import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Rect } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { createStoredStore } from '@/lib/storage';
import { useViewerData } from '../state/viewer-data';
import {
  BOX_FADE_MS,
  DEFAULT_BOX_STAY,
  parseBoxStay,
  type BoxStay,
  type ShowBox,
} from './lib/show-times';
import { useShowMessages, type ShowChannel } from './show-hooks';

/** How long drawn boxes stay, remembered per browser. */
export const boxStayStore = createStoredStore<BoxStay>({
  key: 'slider.presenter.boxStay',
  parse: parseBoxStay,
  fallback: DEFAULT_BOX_STAY,
  crossTab: true,
});

export const useBoxStay = () =>
  useSyncExternalStore(boxStayStore.subscribe, boxStayStore.getSnapshot);

/** The drawn boxes' colour: one's own accent, as one's boxes in „Besprechen“. */
export function useBoxColor(): string {
  return accentColor(useViewerData().viewer.author.color);
}

/**
 * Boxes drawn on the slide while presenting – a laser pointer in the look of the comment boxes,
 * no comment made. Shared with the other window over the show's channel; gone after their stay
 * (`useBoxStay`), at the next slide, or cleared (Esc).
 */
export function useShowBoxes(channel: ShowChannel, slideId: string | null) {
  const [boxes, setBoxes] = useState<ShowBox[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const stay = useBoxStay();
  // Another slide: the boxes were about the one before.
  const [onSlide, setOnSlide] = useState(slideId);
  if (onSlide !== slideId) {
    setOnSlide(slideId);
    setBoxes([]);
  }
  useShowMessages(channel, (message) => {
    if (message.type === 'box') setBoxes((list) => [...list, message.box]);
    if (message.type === 'clear') setBoxes([]);
  });
  // While one fades, every frame; boxes gone are dropped.
  const timed = boxes.some((box) => box.until !== null);
  useEffect(() => {
    if (!timed) return;
    let frame = 0;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      setBoxes((list) => {
        const kept = list.filter((box) => box.until === null || box.until > at);
        return kept.length === list.length ? list : kept;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timed]);

  const shown = boxes.filter((box) => box.slideId === slideId);
  const add = (rect: Rect) => {
    if (!slideId) return;
    const box: ShowBox = {
      id: Math.random().toString(36).slice(2),
      slideId,
      ...rect,
      until: stay === 'slide' ? null : Date.now() + stay * 1000 + BOX_FADE_MS,
    };
    setBoxes((list) => [...list, box]);
    channel.post({ type: 'box', box });
  };
  /** Clears them (here and there); `false` when there were none. */
  const clear = () => {
    if (shown.length === 0) return false;
    setBoxes([]);
    channel.post({ type: 'clear' });
    return true;
  };
  return { boxes: shown, now, add, clear };
}
